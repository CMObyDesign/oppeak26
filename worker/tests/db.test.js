// Phase 1a: unit tests for the D1 data-access module. No real D1 — a mock
// handle records every prepare/bind/run/first/all call so tests assert
// the SQL and bind params are correct. See worker/src/db.js for the
// contracts this module enforces.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  dbFromEnv,
  newSubmissionId,
  newReportId,
  insertSubmission,
  nextReportVersion,
  insertReportVersion,
  latestSuccessfulReport,
  reportByVersion,
  reportById,
  recordGhlSyncAttempt,
} from "../src/db.js";

// --- Mock D1 handle --------------------------------------------------------
// The real D1 API: `env.DB.prepare(sql).bind(...).run()/.first()/.all()`.
// This mock records every statement issued and returns configurable results.
function makeMockDb({ firstResult, allResults, runError } = {}) {
  const log = [];
  const api = {
    prepare(sql) {
      const entry = { sql, binds: [] };
      log.push(entry);
      return {
        bind(...args) {
          entry.binds = args;
          return this;
        },
        async run() {
          if (runError) throw runError;
          return { success: true };
        },
        async first() {
          return typeof firstResult === "function" ? firstResult(entry) : (firstResult ?? null);
        },
        async all() {
          return { results: typeof allResults === "function" ? allResults(entry) : (allResults ?? []) };
        },
      };
    },
    _log: log,
  };
  return api;
}

describe("dbFromEnv", () => {
  it("returns the handle when SOLOMON_DB is bound", () => {
    const fakeHandle = { prepare: () => ({}) };
    assert.equal(dbFromEnv({ SOLOMON_DB: fakeHandle }), fakeHandle);
  });

  it("returns null when the binding is missing", () => {
    assert.equal(dbFromEnv({}), null);
    assert.equal(dbFromEnv(undefined), null);
  });

  it("returns null when SOLOMON_DB is a non-D1 object (defensive)", () => {
    assert.equal(dbFromEnv({ SOLOMON_DB: { thisIsNotD1: true } }), null);
  });
});

describe("newSubmissionId / newReportId", () => {
  it("produce distinct UUID-shaped strings", () => {
    const a = newSubmissionId();
    const b = newReportId();
    assert.match(a, /^[0-9a-f-]{36}$/);
    assert.match(b, /^[0-9a-f-]{36}$/);
    assert.notEqual(a, b);
  });
});

describe("insertSubmission", () => {
  it("returns a skipped sentinel when db is null (fallback contract)", async () => {
    const result = await insertSubmission(null, { id: "x", contact_id: "c", tier: "free", raw_answers: [] });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "no_db_binding");
  });

  it("stringifies JSON columns and binds all fields in schema order", async () => {
    const db = makeMockDb();
    const id = newSubmissionId();
    const answers = [{ question: "Q1", answer: "A1" }];
    const result = await insertSubmission(db, {
      id,
      contact_id: "contact_abc",
      tier: "paid_47",
      source_event_id: "evt_123",
      raw_answers: answers,
      validation: { complete: true, missing_fields: [] },
    });
    assert.equal(result.ok, true);
    assert.equal(result.id, id);
    assert.equal(db._log.length, 1);
    const call = db._log[0];
    assert.match(call.sql, /INSERT INTO submissions/);
    const binds = call.binds;
    // Positional binds: id, contact_id, tier, assessment_version,
    //                   source_event_id, created_at, raw_answers_json,
    //                   normalized_answers_json, derived_metrics_json,
    //                   validation_json, status
    assert.equal(binds[0], id);
    assert.equal(binds[1], "contact_abc");
    assert.equal(binds[2], "paid_47");
    assert.equal(binds[3], "v1"); // default assessment_version
    assert.equal(binds[4], "evt_123");
    assert.ok(Number.isInteger(binds[5]) && binds[5] > 0, "created_at should be a positive integer");
    assert.equal(binds[6], JSON.stringify(answers));
    assert.equal(binds[7], null); // normalized_answers_json
    assert.equal(binds[8], null); // derived_metrics_json
    assert.equal(binds[9], JSON.stringify({ complete: true, missing_fields: [] }));
    assert.equal(binds[10], "ready"); // default status
  });

  it("returns {duplicate:true} on UNIQUE constraint violation", async () => {
    const db = makeMockDb({
      runError: Object.assign(new Error("D1_ERROR: UNIQUE constraint failed: submissions.source_event_id"), {}),
    });
    const result = await insertSubmission(db, {
      id: "x", contact_id: "c", tier: "free",
      source_event_id: "evt_dupe", raw_answers: [],
    });
    assert.equal(result.ok, false);
    assert.equal(result.duplicate, true);
    assert.equal(result.source_event_id, "evt_dupe");
  });

  it("rethrows unexpected errors (not a UNIQUE violation)", async () => {
    const db = makeMockDb({
      runError: new Error("D1_ERROR: no such table"),
    });
    await assert.rejects(
      () => insertSubmission(db, { id: "x", contact_id: "c", tier: "free", raw_answers: [] }),
      /no such table/,
    );
  });
});

describe("nextReportVersion", () => {
  it("returns 1 for the first generation (NULL MAX)", async () => {
    const db = makeMockDb({ firstResult: { v: null } });
    assert.equal(await nextReportVersion(db, "sub_1"), 1);
  });

  it("returns N+1 when N already exists", async () => {
    const db = makeMockDb({ firstResult: { v: 3 } });
    assert.equal(await nextReportVersion(db, "sub_1"), 4);
  });

  it("returns 1 when db is null (fallback contract — safe default)", async () => {
    assert.equal(await nextReportVersion(null, "sub_1"), 1);
  });
});

describe("insertReportVersion", () => {
  it("stringifies diagnostic + strategist_brief, binds every field", async () => {
    const db = makeMockDb();
    const id = newReportId();
    const diagnostic = { path: "needs-attention", gaps: [1, 2, 3] };
    const brief = { note: "internal" };
    const result = await insertReportVersion(db, {
      id,
      submission_id: "sub_1",
      contact_id: "c",
      tier: "free",
      report_version: 2,
      classification: "needs-attention",
      diagnostic,
      strategist_brief: brief,
      prompt_version: "p-v3",
      rubric_version: "r-v4",
      model_version: "claude-sonnet-4-5",
      code_version: "abc1234",
      r2_html_key: "reports/c/x/report.html",
      r2_html_bytes: 19434,
      r2_html_sha256: "deadbeef",
      is_successful: true,
    });
    assert.equal(result.ok, true);
    const call = db._log[0];
    assert.match(call.sql, /INSERT INTO report_versions/);
    const binds = call.binds;
    assert.equal(binds[0], id);
    assert.equal(binds[1], "sub_1");
    assert.equal(binds[2], "c");
    assert.equal(binds[3], "free");
    assert.equal(binds[4], 2);
    assert.equal(binds[5], "needs-attention");
    assert.equal(binds[6], JSON.stringify(diagnostic));
    assert.equal(binds[7], JSON.stringify(brief));
    assert.equal(binds[8], "p-v3");
    assert.equal(binds[9], "r-v4");
    assert.equal(binds[10], "claude-sonnet-4-5");
    assert.equal(binds[11], "abc1234");
    assert.equal(binds[12], "reports/c/x/report.html");
    assert.equal(binds[13], 19434);
    assert.equal(binds[14], "deadbeef");
    assert.ok(Number.isInteger(binds[15]), "created_at should be an integer");
    assert.equal(binds[16], 1); // is_successful true -> 1
  });

  it("records is_successful=0 when the caller marks a failure for audit", async () => {
    const db = makeMockDb();
    await insertReportVersion(db, {
      id: "r1", submission_id: "sub_1", contact_id: "c", tier: "free",
      report_version: 1, diagnostic: {}, is_successful: false,
    });
    assert.equal(db._log[0].binds[16], 0);
  });

  it("skips when db is null", async () => {
    const result = await insertReportVersion(null, {
      id: "r", submission_id: "s", contact_id: "c", tier: "free", report_version: 1, diagnostic: {},
    });
    assert.equal(result.skipped, true);
  });
});

describe("latestSuccessfulReport", () => {
  it("hydrates JSON columns into the returned object", async () => {
    const stored = {
      id: "r1",
      submission_id: "sub_1",
      contact_id: "c",
      tier: "paid_47",
      report_version: 3,
      classification: "growth",
      diagnostic_json: JSON.stringify({ path: "growth", gaps: [] }),
      strategist_brief_json: JSON.stringify({ note: "internal" }),
      prompt_version: "p1",
      rubric_version: "r1",
      model_version: "m1",
      code_version: "sha",
      r2_html_key: "k",
      r2_html_bytes: 100,
      r2_html_sha256: "h",
      created_at: 1700000000000,
      is_successful: 1,
    };
    const db = makeMockDb({ firstResult: stored });
    const result = await latestSuccessfulReport(db, "c");
    assert.deepEqual(result.diagnostic, { path: "growth", gaps: [] });
    assert.deepEqual(result.strategist_brief, { note: "internal" });
    assert.equal(result.report_version, 3);
    assert.equal(result.is_successful, true);
    assert.match(db._log[0].sql, /WHERE contact_id = \? AND is_successful = 1/);
    assert.match(db._log[0].sql, /ORDER BY created_at DESC/);
  });

  it("returns null when no row is found", async () => {
    const db = makeMockDb({ firstResult: null });
    assert.equal(await latestSuccessfulReport(db, "c"), null);
  });

  it("returns null when db is null (not-wired fallback)", async () => {
    assert.equal(await latestSuccessfulReport(null, "c"), null);
  });
});

describe("reportByVersion", () => {
  it("binds contact_id and version in that order", async () => {
    const db = makeMockDb({ firstResult: null });
    await reportByVersion(db, "contact_x", 2);
    assert.deepEqual(db._log[0].binds, ["contact_x", 2]);
  });

  it("coerces string versions to numbers", async () => {
    const db = makeMockDb({ firstResult: null });
    await reportByVersion(db, "c", "5");
    assert.equal(db._log[0].binds[1], 5);
  });
});

describe("reportById", () => {
  it("binds the report id", async () => {
    const db = makeMockDb({ firstResult: null });
    await reportById(db, "r-uuid");
    assert.match(db._log[0].sql, /WHERE id = \?/);
    assert.deepEqual(db._log[0].binds, ["r-uuid"]);
  });
});

describe("recordGhlSyncAttempt", () => {
  it("marks synced_at only on success", async () => {
    const db = makeMockDb();
    await recordGhlSyncAttempt(db, {
      report_id: "r1", contact_id: "c", status: "succeeded",
    });
    const call = db._log[0];
    assert.match(call.sql, /INSERT INTO ghl_sync/);
    assert.equal(call.binds[2], "succeeded"); // status
    assert.ok(Number.isInteger(call.binds[6]), "synced_at should be set when status=succeeded");
  });

  it("leaves synced_at NULL on pending or failed", async () => {
    const db = makeMockDb();
    await recordGhlSyncAttempt(db, {
      report_id: "r1", contact_id: "c", status: "failed", error: "boom",
    });
    assert.equal(db._log[0].binds[2], "failed");
    assert.equal(db._log[0].binds[4], "boom");
    assert.equal(db._log[0].binds[6], null, "synced_at must be null for failed attempts");
  });

  it("defaults attempt_count to 1", async () => {
    const db = makeMockDb();
    await recordGhlSyncAttempt(db, {
      report_id: "r1", contact_id: "c", status: "pending",
    });
    assert.equal(db._log[0].binds[3], 1);
  });
});
