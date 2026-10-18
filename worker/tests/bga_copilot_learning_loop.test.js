// Slice D regression tests — learning loop (aggregator + admin API).
//
// Covers:
//   1. All handlers 401 without the console password header.
//   2. /scan on an empty overrides table: 0 candidates / 0 created.
//   3. /scan skips groups below OCCURRENCE_THRESHOLD (noise).
//   4. /scan ignores include + edit_reason (non-contributing actions).
//   5. /scan creates one suggestion per (service_id, action) group
//      at or above threshold.
//   6. /scan is idempotent — a second scan with no new overrides
//      updates the existing row (occurrenceCount unchanged, no
//      duplicates created).
//   7. /scan is sticky on dismissed rows UNLESS new overrides push
//      count by at least DISMISS_REOPEN_DELTA → reopened to 'pending'.
//   8. Revoked overrides don't contribute (slice C soft-delete).
//   9. /suggestions filters by status; "all" returns everything.
//  10. /suggestion returns one row's detail; 404s on missing id.
//  11. /suggestion/decide requires id/by/decision; rejects unknown
//      decisions; requires a non-empty note on dismiss.
//  12. /suggestion/decide writes status + decided_by + decided_at.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  handleScanSuggestions,
  handleListSuggestions,
  handleGetSuggestion,
  handleDecideSuggestion,
} from "../src/bga_copilot/learning_loop.js";

// -----------------------------------------------------------------------
// Fake D1 — supports the aggregator + CRUD queries. State is a flat
// array of override rows + a flat array of suggestion rows.
// -----------------------------------------------------------------------
function makeFakeDb({ overrides = [], suggestions = [] } = {}) {
  const state = {
    overrides: [...overrides],
    suggestions: [...suggestions],
    nextSuggestionId: 1,
  };
  function prepare(sql) {
    // SELECT contributing overrides, newest first.
    if (/FROM bga_strategist_overrides[\s\S]+revoked_at IS NULL[\s\S]+action IN/i.test(sql)) {
      return {
        all: async () => {
          const list = state.overrides
            .filter((o) => !o.revoked_at && ["defer","not_a_fit","manual_add","edit_dependencies"].includes(o.action))
            .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
          return { results: list };
        },
      };
    }
    // SELECT * suggestions snapshot (used by aggregator).
    if (/^\s*SELECT id, pattern_key, status, occurrence_count/i.test(sql)) {
      return { all: async () => ({ results: state.suggestions.slice() }) };
    }
    // INSERT suggestion.
    if (/INSERT INTO bga_pending_rule_suggestions/i.test(sql)) {
      return {
        bind: (pattern_key, service_id, action, summary, evidence_json, proposed_patch_json, occurrence_count, first_seen_at, last_scanned_at) => ({
          run: async () => {
            const id = state.nextSuggestionId++;
            state.suggestions.push({
              id, pattern_key, service_id, action, summary,
              evidence_json, proposed_patch_json, occurrence_count,
              status: "pending", decided_by: null, decided_at: null, decision_note: null,
              first_seen_at, last_scanned_at,
            });
            return { meta: { last_row_id: id } };
          },
        }),
      };
    }
    // UPDATE (reopen).
    if (/UPDATE bga_pending_rule_suggestions[\s\S]+status = 'pending'[\s\S]+WHERE id = \?/i.test(sql)) {
      return {
        bind: (summary, evidence_json, proposed_patch_json, occurrence_count, last_scanned_at, id) => ({
          run: async () => {
            const row = state.suggestions.find((r) => r.id === id);
            if (row) {
              row.summary = summary;
              row.evidence_json = evidence_json;
              row.proposed_patch_json = proposed_patch_json;
              row.occurrence_count = occurrence_count;
              row.status = "pending";
              row.decided_by = null;
              row.decided_at = null;
              row.decision_note = null;
              row.last_scanned_at = last_scanned_at;
            }
            return { meta: {} };
          },
        }),
      };
    }
    // UPDATE (refresh).
    if (/UPDATE bga_pending_rule_suggestions[\s\S]+SET summary[\s\S]+WHERE id = \?/i.test(sql)) {
      return {
        bind: (summary, evidence_json, proposed_patch_json, occurrence_count, last_scanned_at, id) => ({
          run: async () => {
            const row = state.suggestions.find((r) => r.id === id);
            if (row) {
              row.summary = summary;
              row.evidence_json = evidence_json;
              row.proposed_patch_json = proposed_patch_json;
              row.occurrence_count = occurrence_count;
              row.last_scanned_at = last_scanned_at;
            }
            return { meta: {} };
          },
        }),
      };
    }
    // UPDATE (decide).
    if (/UPDATE bga_pending_rule_suggestions[\s\S]+SET status = \?,/i.test(sql)) {
      return {
        bind: (status, decided_by, decided_at, decision_note, id) => ({
          run: async () => {
            const row = state.suggestions.find((r) => r.id === id);
            if (row) {
              row.status = status;
              row.decided_by = decided_by;
              row.decided_at = decided_at;
              row.decision_note = decision_note;
            }
            return { meta: {} };
          },
        }),
      };
    }
    // GET by id.
    if (/SELECT id, status FROM bga_pending_rule_suggestions WHERE id = \?/i.test(sql)
     || /SELECT \* FROM bga_pending_rule_suggestions WHERE id = \?/i.test(sql)) {
      return {
        bind: (id) => ({
          first: async () => state.suggestions.find((r) => r.id === id) || null,
        }),
      };
    }
    // LIST all.
    if (/SELECT \* FROM bga_pending_rule_suggestions[\s\S]+ORDER BY \(status = 'pending'\)/i.test(sql)) {
      return {
        all: async () => ({
          results: [...state.suggestions].sort((a, b) => {
            if ((a.status === "pending") !== (b.status === "pending")) return a.status === "pending" ? -1 : 1;
            return (b.occurrence_count || 0) - (a.occurrence_count || 0) || b.id - a.id;
          }),
        }),
      };
    }
    // LIST by status.
    if (/SELECT \* FROM bga_pending_rule_suggestions[\s\S]+WHERE status = \?/i.test(sql)) {
      return {
        bind: (status) => ({
          all: async () => ({
            results: state.suggestions
              .filter((r) => r.status === status)
              .sort((a, b) => (b.occurrence_count || 0) - (a.occurrence_count || 0) || b.id - a.id),
          }),
        }),
      };
    }
    throw new Error(`fake D1 unexpected SQL: ${sql.slice(0, 120)}`);
  }
  return { prepare, _state: state };
}

const OK  = { checkPassword: () => true };
const BAD = { checkPassword: () => false };

function postReq(body) {
  return new Request("http://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}
async function readJson(resp) {
  const t = await resp.text();
  try { return JSON.parse(t); } catch { return { __raw: t }; }
}

function ovr(id, service_id, action, extras = {}) {
  return {
    id, contact_id: extras.contact_id || `c_${id}`,
    catalog_version_id: extras.catalog_version_id || 1,
    service_id, action,
    reason: extras.reason || null,
    payload_json: extras.payload_json || "{}",
    created_by: extras.created_by || "liz@x",
    created_at: extras.created_at || `2026-10-18T00:${String(id).padStart(2, "0")}:00Z`,
    revoked_at: extras.revoked_at || null,
    revoked_by: extras.revoked_by || null,
  };
}

describe("learning_loop handlers (slice D)", () => {
  it("1. all handlers 401 without the password header", async () => {
    const env = { SOLOMON_DB: makeFakeDb() };
    for (const h of [handleScanSuggestions, handleListSuggestions, handleGetSuggestion, handleDecideSuggestion]) {
      const r = await h(postReq({ id: 1, by: "x", decision: "approved" }), env, BAD);
      assert.equal(r.status, 401);
    }
  });

  it("2. /scan on empty overrides returns 0 candidates / 0 created", async () => {
    const env = { SOLOMON_DB: makeFakeDb() };
    const r = await handleScanSuggestions(postReq({}), env, OK);
    const b = await readJson(r);
    assert.equal(b.success, true);
    assert.equal(b.candidates, 0);
    assert.equal(b.created, 0);
  });

  it("3. /scan skips groups below the threshold", async () => {
    const env = { SOLOMON_DB: makeFakeDb({
      overrides: [ovr(1, "svc_a", "defer", { reason: "r" })],
    }) };
    const r = await handleScanSuggestions(postReq({}), env, OK);
    const b = await readJson(r);
    assert.equal(b.candidates, 1);
    assert.equal(b.created, 0);
    assert.equal(b.skipped, 1);
  });

  it("4. /scan ignores include + edit_reason (non-contributing actions)", async () => {
    const env = { SOLOMON_DB: makeFakeDb({
      overrides: [
        ovr(1, "svc_a", "include"),
        ovr(2, "svc_a", "include"),
        ovr(3, "svc_a", "edit_reason", { reason: "clarify" }),
      ],
    }) };
    const r = await handleScanSuggestions(postReq({}), env, OK);
    const b = await readJson(r);
    assert.equal(b.candidates, 0);
    assert.equal(b.created, 0);
  });

  it("5. /scan creates one suggestion per (service_id, action) group at threshold", async () => {
    const db = makeFakeDb({
      overrides: [
        ovr(1, "svc_vf", "not_a_fit", { reason: "owner-op business" }),
        ovr(2, "svc_vf", "not_a_fit", { reason: "pre-revenue" }),
        ovr(3, "svc_growth", "defer",  { reason: "legal distress first" }),
        ovr(4, "svc_growth", "defer",  { reason: "legal distress first" }),
      ],
    });
    const env = { SOLOMON_DB: db };
    const r = await readJson(await handleScanSuggestions(postReq({}), env, OK));
    assert.equal(r.success, true);
    assert.equal(r.created, 2);
    assert.equal(r.updated, 0);
    assert.equal(db._state.suggestions.length, 2);
    const list = await readJson(await handleListSuggestions(postReq({}), env, OK));
    assert.equal(list.items.length, 2);
    const vf = list.items.find((s) => s.serviceId === "svc_vf");
    assert.equal(vf.action, "not_a_fit");
    assert.equal(vf.occurrenceCount, 2);
    assert.equal(vf.evidence.length, 2);
    assert.match(vf.summary, /svc_vf/);
    assert.match(vf.summary, /not_a_fit/);
  });

  it("6. /scan is idempotent — a second scan upserts, no duplicates", async () => {
    const db = makeFakeDb({
      overrides: [
        ovr(1, "svc_vf", "not_a_fit", { reason: "r1" }),
        ovr(2, "svc_vf", "not_a_fit", { reason: "r2" }),
      ],
    });
    const env = { SOLOMON_DB: db };
    await handleScanSuggestions(postReq({}), env, OK);
    const r2 = await readJson(await handleScanSuggestions(postReq({}), env, OK));
    assert.equal(r2.created, 0);
    assert.equal(r2.updated, 1);
    assert.equal(db._state.suggestions.length, 1);
    assert.equal(db._state.suggestions[0].occurrence_count, 2);
  });

  it("7. /scan reopens a dismissed row when count grows by DISMISS_REOPEN_DELTA", async () => {
    const db = makeFakeDb({ overrides: [
      ovr(1, "svc_vf", "not_a_fit", { reason: "r1" }),
      ovr(2, "svc_vf", "not_a_fit", { reason: "r2" }),
    ] });
    const env = { SOLOMON_DB: db };
    await handleScanSuggestions(postReq({}), env, OK);
    // Dismiss the suggestion.
    const id = db._state.suggestions[0].id;
    await handleDecideSuggestion(postReq({ id, decision: "dismissed", by: "x", note: "not a pattern" }), env, OK);
    assert.equal(db._state.suggestions[0].status, "dismissed");
    // Add 3 more overrides on the same service+action → count 5 (delta ≥ 3).
    db._state.overrides.push(
      ovr(3, "svc_vf", "not_a_fit", { reason: "r3" }),
      ovr(4, "svc_vf", "not_a_fit", { reason: "r4" }),
      ovr(5, "svc_vf", "not_a_fit", { reason: "r5" }),
    );
    const r = await readJson(await handleScanSuggestions(postReq({}), env, OK));
    assert.equal(r.reopened, 1);
    assert.equal(db._state.suggestions[0].status, "pending");
    assert.equal(db._state.suggestions[0].decided_by, null);
  });

  it("8. Revoked overrides don't contribute to the aggregator", async () => {
    const env = { SOLOMON_DB: makeFakeDb({
      overrides: [
        ovr(1, "svc_vf", "not_a_fit", { reason: "r1" }),
        ovr(2, "svc_vf", "not_a_fit", { reason: "r2", revoked_at: "2026-10-18T00:30:00Z", revoked_by: "liz" }),
      ],
    }) };
    const r = await readJson(await handleScanSuggestions(postReq({}), env, OK));
    assert.equal(r.candidates, 1);
    assert.equal(r.created, 0);
    assert.equal(r.skipped, 1); // one row remains after dropping revoked → below threshold
  });

  it("9. /suggestions filters by status; 'all' returns everything", async () => {
    const db = makeFakeDb({
      overrides: [
        ovr(1, "svc_a", "defer", { reason: "r1" }),
        ovr(2, "svc_a", "defer", { reason: "r2" }),
      ],
      suggestions: [
        { id: 90, pattern_key: "svc_z|defer", service_id: "svc_z", action: "defer",
          summary: "x", evidence_json: "[]", proposed_patch_json: "{}",
          occurrence_count: 5, status: "approved", decided_by: "me", decided_at: "t",
          decision_note: null, first_seen_at: "t", last_scanned_at: "t" },
      ],
    });
    const env = { SOLOMON_DB: db };
    await handleScanSuggestions(postReq({}), env, OK);
    const pending  = await readJson(await handleListSuggestions(postReq({ status: "pending"  }), env, OK));
    const approved = await readJson(await handleListSuggestions(postReq({ status: "approved" }), env, OK));
    const all      = await readJson(await handleListSuggestions(postReq({ status: "all"      }), env, OK));
    assert.equal(pending.items.length,  1);
    assert.equal(approved.items.length, 1);
    assert.equal(all.items.length,      2);
  });

  it("10. /suggestion returns one row; 404 on missing id", async () => {
    const env = { SOLOMON_DB: makeFakeDb() };
    const miss = await handleGetSuggestion(postReq({ id: 9999 }), env, OK);
    assert.equal(miss.status, 404);
  });

  it("11. /suggestion/decide validates inputs", async () => {
    const env = { SOLOMON_DB: makeFakeDb() };
    for (const [body, pat] of [
      [{ }, /id must be a positive integer/],
      [{ id: 1 }, /by \(operator identifier\) required/],
      [{ id: 1, by: "x" }, /decision must be one of/],
      [{ id: 1, by: "x", decision: "bogus" }, /decision must be one of/],
      [{ id: 1, by: "x", decision: "dismissed" }, /dismissed.*requires a non-empty note/],
    ]) {
      const r = await handleDecideSuggestion(postReq(body), env, OK);
      assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(body)}`);
      const parsed = await readJson(r);
      assert.match(parsed.error, pat);
    }
  });

  it("12. /suggestion/decide writes status + decided_by + decided_at", async () => {
    const db = makeFakeDb({
      overrides: [
        ovr(1, "svc_vf", "manual_add", { payload_json: '{"name":"Q4 CFO Bundle"}' }),
        ovr(2, "svc_vf", "manual_add", { payload_json: '{"name":"Q4 CFO Bundle"}' }),
      ],
    });
    const env = { SOLOMON_DB: db };
    await handleScanSuggestions(postReq({}), env, OK);
    const id = db._state.suggestions[0].id;
    const r = await readJson(await handleDecideSuggestion(postReq({ id, decision: "approved", by: "ceo@x" }), env, OK));
    assert.equal(r.success, true);
    assert.equal(r.status, "approved");
    assert.equal(db._state.suggestions[0].status, "approved");
    assert.equal(db._state.suggestions[0].decided_by, "ceo@x");
  });
});
