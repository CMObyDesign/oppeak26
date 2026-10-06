// Phase 3A: strategist feedback capture.
//
// Capture-only. Nothing in this layer makes Solomon learn from itself —
// rule promotion is a separate, human-gated step (Phase 3C) that reads
// approved rows out of this table. These tests cover:
//
//   - FEEDBACK_TYPES is the exact 16-item vocabulary from
//     docs/SOLOMON_ARCHITECTURE.md § 22.
//   - insertFeedback happy path (all optional fields present + absent)
//   - insertFeedback rejects invalid feedback_type with a shape error
//   - insertFeedback rejects missing report_id
//   - insertFeedback returns {skipped:true} when D1 isn't wired
//   - listFeedbackForReport runs the right query and hydrates rows
//   - listPendingFeedbackByType filters to approved_for_learning = 0

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FEEDBACK_TYPES,
  newFeedbackId,
  insertFeedback,
  listFeedbackForReport,
  listPendingFeedbackByType,
} from "../src/db.js";

function makeMockDb({ firstResult, allResults, runError } = {}) {
  const log = [];
  return {
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
        async all() {
          return { results: typeof allResults === "function" ? allResults(entry) : (allResults ?? []) };
        },
      };
    },
    _log: log,
  };
}

// --- FEEDBACK_TYPES vocabulary ----------------------------------------

describe("FEEDBACK_TYPES", () => {
  it("includes every category from the architecture doc § 22", () => {
    // If this list changes, update docs AND the strategist review UI
    // (Phase 3B) in lockstep. The set is enforced in code so a new
    // category can be added without a schema migration.
    const expected = [
      "factual_error",
      "invented_fact",
      "tier_leakage",
      "causal_overreach",
      "severity_overstatement",
      "severity_understatement",
      "bad_calculation",
      "poor_personalization",
      "weak_opportunity",
      "generic_language",
      "incorrect_classification",
      "financial_terminology",
      "bad_cta",
      "missing_context",
      "great_output",
      "approved_example",
    ];
    assert.deepEqual([...FEEDBACK_TYPES].sort(), expected.sort());
    assert.equal(FEEDBACK_TYPES.length, 16);
  });

  it("is frozen (no accidental mutation)", () => {
    assert.throws(() => FEEDBACK_TYPES.push("rogue"));
  });
});

// --- newFeedbackId ----------------------------------------------------

describe("newFeedbackId", () => {
  it("produces UUID-shaped strings and they differ", () => {
    const a = newFeedbackId();
    const b = newFeedbackId();
    assert.match(a, /^[0-9a-f-]{36}$/);
    assert.notEqual(a, b);
  });
});

// --- insertFeedback ---------------------------------------------------

describe("insertFeedback — shape validation", () => {
  it("rejects a missing body entirely", async () => {
    const r = await insertFeedback(null, null);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_body");
  });

  it("rejects when report_id is missing or not a string", async () => {
    for (const bad of [{}, { report_id: null }, { report_id: 42 }, { report_id: "" }]) {
      const r = await insertFeedback(makeMockDb(), { ...bad, feedback_type: "causal_overreach" });
      assert.equal(r.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
      assert.equal(r.reason, "missing_report_id");
    }
  });

  it("rejects an invalid feedback_type with a shape error", async () => {
    const r = await insertFeedback(makeMockDb(), {
      report_id: "r1",
      feedback_type: "not_a_real_type",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_feedback_type");
    assert.equal(r.feedback_type, "not_a_real_type");
  });

  it("returns {skipped:true} when D1 is unwired (safe default)", async () => {
    const r = await insertFeedback(null, {
      report_id: "r1",
      feedback_type: "causal_overreach",
    });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true);
    assert.equal(r.reason, "no_db_binding");
  });
});

describe("insertFeedback — happy path", () => {
  it("writes the full row with every field + defaults approved_for_learning to 0", async () => {
    const db = makeMockDb();
    const r = await insertFeedback(db, {
      report_id: "rep_123",
      submission_id: "sub_123",
      contact_id: "contact_xyz",
      finding_id: "ar-aging-001",
      feedback_type: "causal_overreach",
      original_output: "Your collections problem is causing your debt crisis.",
      strategist_revision: "Meaningfully aged receivables may be contributing to cash-flow pressure.",
      reason: "Debt is current; language implied distress.",
      candidate_rule: "Do not classify current corporate debt as distressed without delinquency or liquidity evidence.",
      created_by: "liz@cfobydesign.com",
    });
    assert.equal(r.ok, true);
    assert.match(r.id, /^[0-9a-f-]{36}$/);

    assert.equal(db._log.length, 1);
    const call = db._log[0];
    assert.match(call.sql, /INSERT INTO strategist_feedback/);
    // approved_for_learning literal 0, approved_by/approved_at NULL —
    // the SQL hard-codes them.
    assert.match(call.sql, /0,\s*NULL,\s*NULL/i);

    const binds = call.binds;
    // Positional: id, report_id, submission_id, contact_id, finding_id,
    //             feedback_type, original_output, strategist_revision,
    //             reason, candidate_rule, created_by, created_at
    assert.equal(binds[0], r.id);
    assert.equal(binds[1], "rep_123");
    assert.equal(binds[2], "sub_123");
    assert.equal(binds[3], "contact_xyz");
    assert.equal(binds[4], "ar-aging-001");
    assert.equal(binds[5], "causal_overreach");
    assert.equal(binds[6], "Your collections problem is causing your debt crisis.");
    assert.equal(binds[7], "Meaningfully aged receivables may be contributing to cash-flow pressure.");
    assert.equal(binds[8], "Debt is current; language implied distress.");
    assert.equal(binds[9], "Do not classify current corporate debt as distressed without delinquency or liquidity evidence.");
    assert.equal(binds[10], "liz@cfobydesign.com");
    assert.ok(Number.isInteger(binds[11]) && binds[11] > 0);
  });

  it("accepts whole-report feedback with no finding_id or metadata", async () => {
    const db = makeMockDb();
    const r = await insertFeedback(db, {
      report_id: "rep_bare",
      feedback_type: "great_output",
    });
    assert.equal(r.ok, true);
    const binds = db._log[0].binds;
    assert.equal(binds[4], null); // finding_id
    assert.equal(binds[6], null); // original_output
    assert.equal(binds[10], null); // created_by
  });
});

// --- listFeedbackForReport -------------------------------------------

describe("listFeedbackForReport", () => {
  it("returns [] when db is null", async () => {
    assert.deepEqual(await listFeedbackForReport(null, "r1"), []);
  });

  it("returns [] when reportId is empty", async () => {
    const db = makeMockDb({ allResults: [] });
    const rows = await listFeedbackForReport(db, "");
    assert.deepEqual(rows, []);
    assert.equal(db._log.length, 0, "no query when reportId missing");
  });

  it("binds report_id and sorts by created_at DESC", async () => {
    const db = makeMockDb({ allResults: [] });
    await listFeedbackForReport(db, "rep_123");
    assert.match(db._log[0].sql, /WHERE report_id = \? ORDER BY created_at DESC/);
    assert.deepEqual(db._log[0].binds, ["rep_123"]);
  });

  it("hydrates numeric and boolean columns correctly", async () => {
    const row = {
      id: "fb_1",
      report_id: "rep_1",
      submission_id: "sub_1",
      contact_id: "c1",
      finding_id: "ar-001",
      feedback_type: "causal_overreach",
      original_output: "orig",
      strategist_revision: "rev",
      reason: "r",
      candidate_rule: "cr",
      approved_for_learning: 1,
      approved_by: "liz",
      approved_at: 1700000001000,
      created_by: "liz",
      created_at: 1700000000000,
    };
    const db = makeMockDb({ allResults: [row] });
    const rows = await listFeedbackForReport(db, "rep_1");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].approved_for_learning, true);
    assert.equal(rows[0].approved_at, 1700000001000);
    assert.equal(rows[0].created_at, 1700000000000);
  });
});

// --- listPendingFeedbackByType ---------------------------------------

describe("listPendingFeedbackByType", () => {
  it("filters to approved_for_learning = 0 and the given type", async () => {
    const db = makeMockDb({ allResults: [] });
    await listPendingFeedbackByType(db, "causal_overreach", { limit: 50 });
    assert.match(db._log[0].sql, /WHERE feedback_type = \? AND approved_for_learning = 0/i);
    assert.match(db._log[0].sql, /ORDER BY created_at DESC/);
    assert.deepEqual(db._log[0].binds, ["causal_overreach", 50]);
  });

  it("clamps limit to the 1-500 range", async () => {
    const db1 = makeMockDb({ allResults: [] });
    await listPendingFeedbackByType(db1, "causal_overreach", { limit: 0 });
    assert.equal(db1._log[0].binds[1], 1, "limit floor is 1");

    const db2 = makeMockDb({ allResults: [] });
    await listPendingFeedbackByType(db2, "causal_overreach", { limit: 10000 });
    assert.equal(db2._log[0].binds[1], 500, "limit cap is 500");
  });

  it("defaults limit to 100 when not supplied", async () => {
    const db = makeMockDb({ allResults: [] });
    await listPendingFeedbackByType(db, "causal_overreach");
    assert.equal(db._log[0].binds[1], 100);
  });

  it("returns [] when db is null or type is missing", async () => {
    assert.deepEqual(await listPendingFeedbackByType(null, "causal_overreach"), []);
    assert.deepEqual(await listPendingFeedbackByType(makeMockDb({ allResults: [] }), ""), []);
  });
});
