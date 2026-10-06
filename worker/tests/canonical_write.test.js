// Phase 1b regression: writeCanonicalRecord and its surrounding plumbing.
// The function is best-effort — a D1 or R2 failure MUST NOT throw into
// the caller. These tests exercise:
//   - dry-run short-circuit (no DB touched, no R2 touched)
//   - no-binding short-circuit (DB missing, worker still runs)
//   - no-contact-id short-circuit (synthetic console runs)
//   - happy path: submissions + report_versions inserted, R2 object written
//     with contentType and customMetadata, response shape surfaces IDs
//   - duplicate source_event_id: insertSubmission reports {duplicate:true}
//     and the caller returns a skipped marker without inserting a report
//   - D1 insert failure: logged, {ok:false} returned, nothing thrown

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  writeCanonicalRecord,
  writeReportArtifact,
  recordGhlWriteback,
  ASSESSMENT_VERSION,
  RUBRIC_VERSION,
  PROMPT_VERSION,
} from "../src/index.js";

// Mock D1 handle: records every prepared SQL + bind args, lets each test
// control the outcome of `run()` and `first()`.
function makeMockDb({ firstResult, runError } = {}) {
  const log = [];
  const api = {
    prepare(sql) {
      const entry = { sql, binds: [] };
      log.push(entry);
      return {
        bind(...args) { entry.binds = args; return this; },
        async run() {
          if (runError) throw runError;
          return { success: true };
        },
        async first() {
          return typeof firstResult === "function" ? firstResult(entry) : (firstResult ?? null);
        },
        async all() { return { results: [] }; },
      };
    },
    _log: log,
  };
  return api;
}

// Mock R2 bucket: records every put with its key, body length, options.
function makeMockBucket({ putError } = {}) {
  const log = [];
  return {
    async put(key, body, opts) {
      log.push({ key, body, opts });
      if (putError) throw putError;
      return { key };
    },
    _log: log,
  };
}

const AGENT_FIXTURE = {
  path: "needs-attention",
  badge: "NEEDS ATTENTION",
  headline: "...",
  opener: "...",
  context: "...",
  gaps: [{ title: "g1", impact: "high", priority: "immediate" }],
  opportunities: [{ title: "o1", impact: "revenue" }],
  opportunityFlags: ["DEBT_RESTRUCTURE_OPP"],
  strategistBrief: "internal note",
};

describe("writeCanonicalRecord — short circuits", () => {
  it("returns {skipped: dry_run} when dry_run is true", async () => {
    const db = makeMockDb();
    const bucket = makeMockBucket();
    const result = await writeCanonicalRecord(
      { SOLOMON_DB: db, SOLOMON_REPORTS: bucket },
      { contact: { id: "c1" }, tier: "free", answers: [], agent: AGENT_FIXTURE, reportHtml: "<x/>", dryRun: true }
    );
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "dry_run");
    assert.equal(db._log.length, 0, "dry run must not touch D1");
    assert.equal(bucket._log.length, 0, "dry run must not touch R2");
  });

  it("returns {skipped: no_db_binding} when SOLOMON_DB is missing", async () => {
    const bucket = makeMockBucket();
    const result = await writeCanonicalRecord(
      { SOLOMON_REPORTS: bucket },
      { contact: { id: "c1" }, tier: "free", answers: [], agent: AGENT_FIXTURE, reportHtml: "<x/>" }
    );
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "no_db_binding");
    assert.equal(bucket._log.length, 0, "no DB → do not touch R2 either");
  });

  it("returns {skipped: no_contact_id} when the contact has no id", async () => {
    const db = makeMockDb();
    const result = await writeCanonicalRecord(
      { SOLOMON_DB: db },
      { contact: {}, tier: "free", answers: [], agent: AGENT_FIXTURE, reportHtml: "<x/>" }
    );
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "no_contact_id");
    assert.equal(db._log.length, 0);
  });
});

describe("writeCanonicalRecord — happy path", () => {
  it("inserts submission + report_versions, writes R2, returns IDs", async () => {
    // nextReportVersion issues a SELECT MAX(..) query that returns {v: 0}
    // for a brand new submission; the next version is 1.
    const db = makeMockDb({ firstResult: { v: 0 } });
    const bucket = makeMockBucket();
    const html = "<html>report body</html>";

    const result = await writeCanonicalRecord(
      { SOLOMON_DB: db, SOLOMON_REPORTS: bucket, CODE_VERSION: "abc1234" },
      {
        contact: { id: "contact_xyz", firstName: "Liz" },
        tier: "paid_47",
        answers: [{ question: "Q1", answer: "A1" }],
        agent: AGENT_FIXTURE,
        reportHtml: html,
        sourceEventId: "evt_7",
      }
    );

    assert.equal(result.ok, true);
    assert.match(result.submissionId, /^[0-9a-f-]{36}$/);
    assert.match(result.reportId, /^[0-9a-f-]{36}$/);
    assert.equal(result.reportVersion, 1);
    assert.ok(result.r2_html_key.startsWith("reports/contact_xyz/"));
    assert.ok(result.r2_html_key.endsWith("/report.html"));

    // SQL calls, in order: INSERT submissions, SELECT MAX, INSERT report_versions.
    assert.equal(db._log.length, 3);
    assert.match(db._log[0].sql, /INSERT INTO submissions/);
    assert.match(db._log[1].sql, /SELECT MAX\(report_version\)/);
    assert.match(db._log[2].sql, /INSERT INTO report_versions/);

    // The submission insert carries the right binds in the right order.
    const subBinds = db._log[0].binds;
    assert.equal(subBinds[0], result.submissionId);
    assert.equal(subBinds[1], "contact_xyz");
    assert.equal(subBinds[2], "paid_47");
    assert.equal(subBinds[3], ASSESSMENT_VERSION);
    assert.equal(subBinds[4], "evt_7");
    // created_at (idx 5) is a timestamp
    assert.equal(subBinds[6], JSON.stringify([{ question: "Q1", answer: "A1" }]));

    // The report_versions insert carries the provenance stack.
    const repBinds = db._log[2].binds;
    assert.equal(repBinds[0], result.reportId);
    assert.equal(repBinds[1], result.submissionId);
    assert.equal(repBinds[2], "contact_xyz");
    assert.equal(repBinds[3], "paid_47");
    assert.equal(repBinds[4], 1);                                  // report_version
    assert.equal(repBinds[5], "needs-attention");                  // classification = agent.path
    assert.equal(repBinds[6], JSON.stringify(AGENT_FIXTURE));      // diagnostic_json
    assert.equal(repBinds[7], JSON.stringify({ brief: "internal note" }));
    assert.equal(repBinds[8], PROMPT_VERSION);
    assert.equal(repBinds[9], RUBRIC_VERSION);
    assert.equal(repBinds[10], "claude-sonnet-4-6");               // model_version
    assert.equal(repBinds[11], "abc1234");                         // code_version from env
    assert.equal(repBinds[12], result.r2_html_key);                // r2_html_key
    assert.equal(repBinds[13], new TextEncoder().encode(html).byteLength);
    assert.match(repBinds[14], /^[0-9a-f]{64}$/);                  // sha256 hex
    assert.equal(repBinds[16], 1);                                 // is_successful

    // R2 put occurred exactly once with the right content type and metadata.
    assert.equal(bucket._log.length, 1);
    const put = bucket._log[0];
    assert.equal(put.key, result.r2_html_key);
    assert.equal(put.opts.httpMetadata.contentType, "text/html; charset=utf-8");
    assert.equal(put.opts.customMetadata.contact_id, "contact_xyz");
    assert.equal(put.opts.customMetadata.report_id, result.reportId);
    assert.ok(/^\d+$/.test(put.opts.customMetadata.generated_at));
  });

  it("records null for r2_html_key when SOLOMON_REPORTS is missing", async () => {
    const db = makeMockDb({ firstResult: { v: 0 } });
    const result = await writeCanonicalRecord(
      { SOLOMON_DB: db },
      { contact: { id: "c1" }, tier: "free", answers: [], agent: AGENT_FIXTURE, reportHtml: "<x/>" }
    );
    assert.equal(result.ok, true);
    assert.equal(result.r2_html_key, null);
    // report_versions row still inserted; r2_html_key column is null.
    const repBinds = db._log[2].binds;
    assert.equal(repBinds[12], null, "r2_html_key must be null when bucket missing");
    assert.equal(repBinds[13], null, "r2_html_bytes must be null when bucket missing");
    assert.equal(repBinds[14], null, "r2_html_sha256 must be null when bucket missing");
  });

  it("still writes report_versions when R2 put throws (R2 failure is non-fatal)", async () => {
    const db = makeMockDb({ firstResult: { v: 0 } });
    const bucket = makeMockBucket({ putError: new Error("R2 timeout") });
    const result = await writeCanonicalRecord(
      { SOLOMON_DB: db, SOLOMON_REPORTS: bucket },
      { contact: { id: "c1" }, tier: "free", answers: [], agent: AGENT_FIXTURE, reportHtml: "<x/>" }
    );
    assert.equal(result.ok, true, "R2 failure must not fail the canonical write");
    assert.equal(result.r2_html_key, null);
    // The report_versions row still landed, with null for the R2 columns.
    assert.equal(db._log[2].binds[12], null);
  });
});

describe("writeCanonicalRecord — duplicates and failures", () => {
  it("returns {skipped: duplicate_submission} on UNIQUE violation", async () => {
    const db = makeMockDb({
      runError: new Error("D1_ERROR: UNIQUE constraint failed: submissions.source_event_id"),
    });
    const bucket = makeMockBucket();
    const result = await writeCanonicalRecord(
      { SOLOMON_DB: db, SOLOMON_REPORTS: bucket },
      {
        contact: { id: "c1" }, tier: "paid_47", answers: [], agent: AGENT_FIXTURE,
        reportHtml: "<x/>", sourceEventId: "evt_dupe",
      }
    );
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "duplicate_submission");
    assert.equal(result.source_event_id, "evt_dupe");
    // Only the submission INSERT was attempted; no R2 put, no report_versions.
    assert.equal(db._log.length, 1);
    assert.equal(bucket._log.length, 0);
  });

  it("returns {ok:false} and does not throw on an unrelated D1 error", async () => {
    const db = makeMockDb({ runError: new Error("D1_ERROR: no such table") });
    const result = await writeCanonicalRecord(
      { SOLOMON_DB: db },
      { contact: { id: "c1" }, tier: "free", answers: [], agent: AGENT_FIXTURE, reportHtml: "<x/>" }
    );
    assert.equal(result.ok, false);
    assert.match(result.error, /no such table/);
  });
});

describe("writeReportArtifact", () => {
  it("returns null when the SOLOMON_REPORTS binding is missing", async () => {
    const result = await writeReportArtifact(
      {},
      { contactId: "c1", reportId: "r1", html: "<x/>" }
    );
    assert.equal(result, null);
  });

  it("writes the HTML and returns {key, bytes, sha256}", async () => {
    const bucket = makeMockBucket();
    const html = "<html>test</html>";
    const result = await writeReportArtifact(
      { SOLOMON_REPORTS: bucket },
      { contactId: "c1", reportId: "r1", html }
    );
    assert.equal(result.r2_html_key, "reports/c1/r1/report.html");
    assert.equal(result.r2_html_bytes, new TextEncoder().encode(html).byteLength);
    assert.match(result.r2_html_sha256, /^[0-9a-f]{64}$/);
    assert.equal(bucket._log[0].key, "reports/c1/r1/report.html");
  });

  it("returns null when the R2 put throws", async () => {
    const bucket = makeMockBucket({ putError: new Error("timeout") });
    const result = await writeReportArtifact(
      { SOLOMON_REPORTS: bucket },
      { contactId: "c1", reportId: "r1", html: "<x/>" }
    );
    assert.equal(result, null);
  });
});

describe("recordGhlWriteback", () => {
  it("skips when no reportId was produced (canonical was skipped)", async () => {
    const db = makeMockDb();
    const result = await recordGhlWriteback(
      { SOLOMON_DB: db },
      { reportId: null, contactId: "c1", status: "succeeded" }
    );
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "no_report_id");
    assert.equal(db._log.length, 0);
  });

  it("skips when D1 binding is missing", async () => {
    const result = await recordGhlWriteback(
      {},
      { reportId: "r1", contactId: "c1", status: "succeeded" }
    );
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "no_db_binding");
  });

  it("inserts a succeeded row with synced_at set", async () => {
    const db = makeMockDb();
    const result = await recordGhlWriteback(
      { SOLOMON_DB: db },
      { reportId: "r1", contactId: "c1", status: "succeeded" }
    );
    assert.equal(result.ok, true);
    const call = db._log[0];
    assert.match(call.sql, /INSERT INTO ghl_sync/);
    assert.equal(call.binds[2], "succeeded");
    assert.ok(Number.isInteger(call.binds[6]), "synced_at should be set on success");
  });

  it("inserts a failed row with the error message", async () => {
    const db = makeMockDb();
    await recordGhlWriteback(
      { SOLOMON_DB: db },
      { reportId: "r1", contactId: "c1", status: "failed", error: "GHL 500" }
    );
    const call = db._log[0];
    assert.equal(call.binds[2], "failed");
    assert.equal(call.binds[4], "GHL 500");
    assert.equal(call.binds[6], null, "synced_at must be null on failure");
  });
});
