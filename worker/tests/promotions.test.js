// Phase 3C: rule-promotion queue — db helpers + API routes.
//
// Covers:
//   - pendingFeedbackSummary groups by feedback_type and counts
//     pending vs approved.
//   - listApprovedFeedbackByType filters to approved_for_learning = 1.
//   - updateFeedback: approval toggles stamp/clear approved_by +
//     approved_at; candidate_rule can be edited alone; shape errors
//     and no-D1 safe default.
//   - API: GET /feedback/pending-summary (auth + no-D1 skip),
//     GET /feedback/approved (auth + feedback_type validation),
//     PATCH /feedback/{id} (auth + 404 on missing + skip on no D1).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";
import {
  pendingFeedbackSummary,
  listApprovedFeedbackByType,
  updateFeedback,
  FEEDBACK_TYPES,
} from "../src/db.js";

const PW = "test-password";
const envBase = { CONSOLE_PASSWORD: PW };

// --- Mock D1 that routes by SQL text --------------------------------

function makeDb(spec) {
  const log = [];
  return {
    _log: log,
    prepare(sql) {
      const entry = { sql, binds: [] };
      log.push(entry);
      const bound = {
        bind(...args) { entry.binds = args; return bound; },
        async run() {
          if (/UPDATE strategist_feedback/i.test(sql)) {
            return { success: true, meta: { changes: spec.updateChanges ?? 1 } };
          }
          return { success: true, meta: { changes: 1 } };
        },
        async first() {
          if (/SELECT \* FROM strategist_feedback WHERE id = \?/i.test(sql)) {
            return spec.rowById || null;
          }
          return null;
        },
        async all() {
          if (/GROUP BY feedback_type/i.test(sql)) {
            return { results: spec.summaryRows || [] };
          }
          if (/approved_for_learning = 1/i.test(sql)) {
            return { results: spec.approvedRows || [] };
          }
          if (/approved_for_learning = 0/i.test(sql)) {
            return { results: spec.pendingRows || [] };
          }
          return { results: [] };
        },
      };
      return bound;
    },
  };
}

// --- pendingFeedbackSummary ------------------------------------------

describe("pendingFeedbackSummary", () => {
  it("returns [] when db is null", async () => {
    assert.deepEqual(await pendingFeedbackSummary(null), []);
  });

  it("coerces SUM(...) strings to numbers and preserves order", async () => {
    const db = makeDb({
      summaryRows: [
        { feedback_type: "causal_overreach", pending_count: "3", approved_count: "1" },
        { feedback_type: "great_output", pending_count: 0, approved_count: 2 },
      ],
    });
    const result = await pendingFeedbackSummary(db);
    assert.equal(result.length, 2);
    assert.equal(result[0].feedback_type, "causal_overreach");
    assert.equal(result[0].pending_count, 3);
    assert.equal(result[0].approved_count, 1);
    assert.equal(result[1].pending_count, 0);
    assert.equal(result[1].approved_count, 2);
    assert.match(db._log[0].sql, /ORDER BY pending_count DESC/);
  });
});

// --- listApprovedFeedbackByType -------------------------------------

describe("listApprovedFeedbackByType", () => {
  it("filters to approved_for_learning = 1 with limit clamping", async () => {
    const db = makeDb({ approvedRows: [{ id: "fb_1", approved_for_learning: 1, created_at: 1700000000000 }] });
    const rows = await listApprovedFeedbackByType(db, "causal_overreach", { limit: 10000 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].approved_for_learning, true);
    assert.match(db._log[0].sql, /approved_for_learning = 1/i);
    assert.equal(db._log[0].binds[1], 500, "limit cap is 500");
  });

  it("returns [] when db or type is missing", async () => {
    assert.deepEqual(await listApprovedFeedbackByType(null, "x"), []);
    assert.deepEqual(await listApprovedFeedbackByType(makeDb({}), ""), []);
  });
});

// --- updateFeedback ------------------------------------------------

describe("updateFeedback — shape", () => {
  it("rejects a missing id or patch", async () => {
    assert.equal((await updateFeedback(makeDb({}), null, {})).ok, false);
    assert.equal((await updateFeedback(makeDb({}), "fb_1", null)).ok, false);
    assert.equal((await updateFeedback(makeDb({}), "fb_1", {})).reason, "nothing_to_update");
  });

  it("returns {skipped:true} when D1 is unwired", async () => {
    const r = await updateFeedback(null, "fb_1", { approved_for_learning: true });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true);
    assert.equal(r.reason, "no_db_binding");
  });

  it("returns {ok:false, reason:'not_found'} when the row doesn't exist", async () => {
    const db = makeDb({ updateChanges: 0 });
    const r = await updateFeedback(db, "fb_missing", { approved_for_learning: true });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_found");
  });
});

describe("updateFeedback — approval", () => {
  it("approving stamps approved_by + approved_at", async () => {
    const row = { id: "fb_1", approved_for_learning: 1 };
    const db = makeDb({ rowById: row });
    const r = await updateFeedback(db, "fb_1", { approved_for_learning: true, approved_by: "liz" });
    assert.equal(r.ok, true);
    const update = db._log[0];
    assert.match(update.sql, /SET approved_for_learning = \?, approved_by = \?, approved_at = \?/);
    assert.equal(update.binds[0], 1);
    assert.equal(update.binds[1], "liz");
    assert.ok(Number.isInteger(update.binds[2]) && update.binds[2] > 0, "stamps a timestamp");
  });

  it("unapproving clears approved_by + approved_at via NULL in SQL", async () => {
    const db = makeDb({ rowById: { id: "fb_1", approved_for_learning: 0 } });
    const r = await updateFeedback(db, "fb_1", { approved_for_learning: false });
    assert.equal(r.ok, true);
    assert.match(db._log[0].sql, /approved_by = NULL, approved_at = NULL/);
    assert.equal(db._log[0].binds[0], 0);
  });

  it("candidate_rule can be edited independently of the approval flag", async () => {
    const db = makeDb({ rowById: { id: "fb_1", candidate_rule: "new rule" } });
    const r = await updateFeedback(db, "fb_1", { candidate_rule: "new rule" });
    assert.equal(r.ok, true);
    assert.match(db._log[0].sql, /SET candidate_rule = \?/);
    assert.doesNotMatch(db._log[0].sql, /approved_for_learning/);
    assert.equal(db._log[0].binds[0], "new rule");
  });

  it("falls back to approved_by='unknown' when none provided", async () => {
    const db = makeDb({ rowById: { id: "fb_1" } });
    await updateFeedback(db, "fb_1", { approved_for_learning: true });
    assert.equal(db._log[0].binds[1], "unknown");
  });
});

// --- API routes ----------------------------------------------------

function get(path, { env = envBase, password = PW } = {}) {
  return worker.fetch(
    new Request("https://example.com" + path, {
      method: "GET",
      headers: password ? { "x-console-password": password } : {},
    }),
    env, {},
  );
}
function patchReq(path, body, { env = envBase, password = PW } = {}) {
  return worker.fetch(
    new Request("https://example.com" + path, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(password ? { "x-console-password": password } : {}),
      },
      body: JSON.stringify(body),
    }),
    env, {},
  );
}

describe("GET /feedback/pending-summary", () => {
  it("401s without the password", async () => {
    const res = await get("/feedback/pending-summary", { password: null });
    assert.equal(res.status, 401);
  });

  it("returns {skipped:true} when D1 isn't wired", async () => {
    const res = await get("/feedback/pending-summary");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.skipped, true);
    assert.deepEqual(body.summary, []);
  });

  it("returns the grouped summary when D1 is wired", async () => {
    const env = {
      CONSOLE_PASSWORD: PW,
      SOLOMON_DB: makeDb({ summaryRows: [{ feedback_type: "causal_overreach", pending_count: 2, approved_count: 1 }] }),
    };
    const res = await get("/feedback/pending-summary", { env });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.summary.length, 1);
    assert.equal(body.summary[0].pending_count, 2);
  });
});

describe("GET /feedback/approved", () => {
  it("rejects a missing feedback_type with 400", async () => {
    const env = { CONSOLE_PASSWORD: PW, SOLOMON_DB: makeDb({}) };
    const res = await get("/feedback/approved", { env });
    assert.equal(res.status, 400);
  });

  it("rejects an unknown feedback_type with the allowed list", async () => {
    const env = { CONSOLE_PASSWORD: PW, SOLOMON_DB: makeDb({}) };
    const res = await get("/feedback/approved?feedback_type=nope", { env });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(Array.isArray(body.allowed));
    assert.equal(body.allowed.length, FEEDBACK_TYPES.length);
  });

  it("returns approved rows for a known type", async () => {
    const env = {
      CONSOLE_PASSWORD: PW,
      SOLOMON_DB: makeDb({
        approvedRows: [{
          id: "fb_1", approved_for_learning: 1, approved_by: "liz",
          approved_at: 1700000001000, created_at: 1700000000000,
          feedback_type: "causal_overreach", candidate_rule: "a rule",
        }],
      }),
    };
    const res = await get("/feedback/approved?feedback_type=causal_overreach", { env });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.feedback[0].approved_for_learning, true);
  });
});

describe("PATCH /feedback/{id}", () => {
  it("401s without the password", async () => {
    const res = await patchReq("/feedback/fb_1", { approved_for_learning: true }, { password: null });
    assert.equal(res.status, 401);
  });

  it("returns {skipped:true} when D1 isn't wired", async () => {
    const res = await patchReq("/feedback/fb_1", { approved_for_learning: true });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.skipped, true);
  });

  it("404s when the row doesn't exist", async () => {
    const env = { CONSOLE_PASSWORD: PW, SOLOMON_DB: makeDb({ updateChanges: 0 }) };
    const res = await patchReq("/feedback/fb_missing", { approved_for_learning: true }, { env });
    assert.equal(res.status, 404);
  });

  it("200s with the hydrated row on a successful approval", async () => {
    const env = {
      CONSOLE_PASSWORD: PW,
      SOLOMON_DB: makeDb({ rowById: {
        id: "fb_1", approved_for_learning: 1, approved_by: "liz",
        approved_at: 1700000001000, created_at: 1700000000000,
        feedback_type: "causal_overreach",
      }}),
    };
    const res = await patchReq("/feedback/fb_1",
      { approved_for_learning: true, approved_by: "liz", candidate_rule: "r" },
      { env },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.feedback.id, "fb_1");
    assert.equal(body.feedback.approved_for_learning, true);
  });

  it("400s when neither approved_for_learning nor candidate_rule is in the body", async () => {
    const env = { CONSOLE_PASSWORD: PW, SOLOMON_DB: makeDb({}) };
    const res = await patchReq("/feedback/fb_1", { foo: "bar" }, { env });
    assert.equal(res.status, 400);
  });
});
