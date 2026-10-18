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
    // Codex P2 on #141: aggregator now does a GROUP BY first.
    if (/SELECT service_id, action, COUNT\(\*\) AS cnt[\s\S]+GROUP BY service_id, action/i.test(sql)) {
      return {
        all: async () => {
          const counts = new Map();
          for (const o of state.overrides) {
            if (o.revoked_at) continue;
            if (!["defer","not_a_fit","manual_add","edit_dependencies"].includes(o.action)) continue;
            const k = `${o.service_id}|${o.action}`;
            if (!counts.has(k)) counts.set(k, { service_id: o.service_id, action: o.action, cnt: 0 });
            counts.get(k).cnt++;
          }
          return { results: Array.from(counts.values()) };
        },
      };
    }
    // Per-group evidence sample (one query per qualifying group).
    if (/FROM bga_strategist_overrides[\s\S]+WHERE revoked_at IS NULL[\s\S]+service_id = \? AND action = \?[\s\S]+ORDER BY created_at DESC/i.test(sql)) {
      return {
        bind: (sid, action, limit) => ({
          all: async () => {
            const rows = state.overrides
              .filter((o) => !o.revoked_at && o.service_id === sid && o.action === action)
              .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
              .slice(0, limit);
            return { results: rows };
          },
        }),
      };
    }
    // SELECT * suggestions snapshot (used by aggregator). Now also
    // reads dismissed_at_count + service_id + action columns.
    if (/^\s*SELECT id, pattern_key, service_id, action, status, occurrence_count/i.test(sql)) {
      return { all: async () => ({ results: state.suggestions.slice() }) };
    }
    // Legacy snapshot query from older tests — keep for backwards compat.
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
    // UPDATE (reopen) — now also clears dismissed_at_count.
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
              row.dismissed_at_count = null;
              row.last_scanned_at = last_scanned_at;
            }
            return { meta: {} };
          },
        }),
      };
    }
    // UPDATE (reconcile below-threshold or all-revoked). This UPDATE
    // writes summary + occurrence_count + last_scanned_at but not
    // proposed_patch_json. Match it BEFORE the generic refresh.
    if (/UPDATE bga_pending_rule_suggestions[\s\S]+SET occurrence_count = \?, evidence_json = '\[\]'[\s\S]+WHERE id = \?/i.test(sql)) {
      return {
        bind: (realCount, summary, last_scanned_at, id) => ({
          run: async () => {
            const row = state.suggestions.find((r) => r.id === id);
            if (row) {
              row.occurrence_count = realCount;
              row.evidence_json = "[]";
              row.summary = summary;
              row.last_scanned_at = last_scanned_at;
            }
            return { meta: {} };
          },
        }),
      };
    }
    // UPDATE (last_scanned_at only — for already-zero rows).
    if (/UPDATE bga_pending_rule_suggestions[\s\S]+SET last_scanned_at = \?[\s\S]+WHERE id = \?/i.test(sql)) {
      return {
        bind: (ts, id) => ({
          run: async () => {
            const row = state.suggestions.find((r) => r.id === id);
            if (row) row.last_scanned_at = ts;
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
    // UPDATE (decide → dismissed): also writes dismissed_at_count.
    if (/UPDATE bga_pending_rule_suggestions[\s\S]+dismissed_at_count = occurrence_count/i.test(sql)) {
      return {
        bind: (status, decided_by, decided_at, decision_note, id) => ({
          run: async () => {
            const row = state.suggestions.find((r) => r.id === id);
            if (row) {
              row.status = status;
              row.decided_by = decided_by;
              row.decided_at = decided_at;
              row.decision_note = decision_note;
              row.dismissed_at_count = row.occurrence_count;
            }
            return { meta: {} };
          },
        }),
      };
    }
    // UPDATE (decide → non-dismissed): clears dismissed_at_count.
    if (/UPDATE bga_pending_rule_suggestions[\s\S]+dismissed_at_count = NULL/i.test(sql)) {
      return {
        bind: (status, decided_by, decided_at, decision_note, id) => ({
          run: async () => {
            const row = state.suggestions.find((r) => r.id === id);
            if (row) {
              row.status = status;
              row.decided_by = decided_by;
              row.decided_at = decided_at;
              row.decision_note = decision_note;
              row.dismissed_at_count = null;
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

  it("12. Codex P2 on #141: dismissal baseline persists across intermediate scans", async () => {
    // Repro of the Codex bug: dismissed at count=2, overrides grow
    // to 3, 4, 5 — the row MUST reopen when (count - baseline=2) >=
    // DISMISS_REOPEN_DELTA=3, i.e. at count=5. The pre-fix code
    // reset the baseline on each refresh, so delta was always 1.
    const db = makeFakeDb({ overrides: [
      ovr(1, "svc_vf", "not_a_fit", { reason: "r1" }),
      ovr(2, "svc_vf", "not_a_fit", { reason: "r2" }),
    ] });
    const env = { SOLOMON_DB: db };
    await handleScanSuggestions(postReq({}), env, OK);
    const id = db._state.suggestions[0].id;
    await handleDecideSuggestion(postReq({ id, decision: "dismissed", by: "x", note: "noise" }), env, OK);
    assert.equal(db._state.suggestions[0].status, "dismissed");
    assert.equal(db._state.suggestions[0].dismissed_at_count, 2);

    // Add 1 more (count 3) → scan refreshes but should NOT reopen.
    db._state.overrides.push(ovr(3, "svc_vf", "not_a_fit", { reason: "r3" }));
    let r = await readJson(await handleScanSuggestions(postReq({}), env, OK));
    assert.equal(r.reopened, 0);
    assert.equal(db._state.suggestions[0].status, "dismissed");
    assert.equal(db._state.suggestions[0].dismissed_at_count, 2, "baseline unchanged on refresh");

    // Add 1 more (count 4) → still shouldn't reopen (delta=2).
    db._state.overrides.push(ovr(4, "svc_vf", "not_a_fit", { reason: "r4" }));
    r = await readJson(await handleScanSuggestions(postReq({}), env, OK));
    assert.equal(r.reopened, 0);
    assert.equal(db._state.suggestions[0].status, "dismissed");

    // Add 1 more (count 5) → now delta=3, must reopen.
    db._state.overrides.push(ovr(5, "svc_vf", "not_a_fit", { reason: "r5" }));
    r = await readJson(await handleScanSuggestions(postReq({}), env, OK));
    assert.equal(r.reopened, 1);
    assert.equal(db._state.suggestions[0].status, "pending");
    assert.equal(db._state.suggestions[0].dismissed_at_count, null, "baseline cleared on reopen");
  });

  it("13. Codex P2 on #141: reconcile below-threshold rows when contributors are revoked", async () => {
    const db = makeFakeDb({ overrides: [
      ovr(1, "svc_vf", "not_a_fit", { reason: "r1" }),
      ovr(2, "svc_vf", "not_a_fit", { reason: "r2" }),
    ] });
    const env = { SOLOMON_DB: db };
    await handleScanSuggestions(postReq({}), env, OK);
    const id = db._state.suggestions[0].id;
    assert.equal(db._state.suggestions[0].occurrence_count, 2);

    // Revoke one contributor → group drops to 1 (below threshold).
    db._state.overrides[1].revoked_at = "2026-10-18T01:00:00Z";
    db._state.overrides[1].revoked_by = "liz@x";
    const r = await readJson(await handleScanSuggestions(postReq({}), env, OK));
    assert.equal(r.reconciled, 1);
    // Row stays, but count + evidence refreshed to reflect reality.
    assert.equal(db._state.suggestions[0].occurrence_count, 1);
    assert.equal(db._state.suggestions[0].evidence_json, "[]");
    assert.match(db._state.suggestions[0].summary, /below the threshold/i);

    // Revoke the other contributor → group vanishes from GROUP BY entirely.
    db._state.overrides[0].revoked_at = "2026-10-18T01:01:00Z";
    const r2 = await readJson(await handleScanSuggestions(postReq({}), env, OK));
    assert.equal(r2.reconciled, 1);
    assert.equal(db._state.suggestions[0].occurrence_count, 0);
    assert.match(db._state.suggestions[0].summary, /revoked/i);
  });

  it("14. Codex P2 on #141: counts come from SQL GROUP BY (no 5000-row LIMIT undercount)", async () => {
    // Build a cohort big enough that the old LIMIT 5000 would have
    // dropped older rows. The GROUP BY aggregator reports the FULL
    // count because the SQL counts without a row-fetch limit.
    const overrides = [];
    for (let i = 1; i <= 6000; i++) {
      overrides.push(ovr(i, "svc_vf", "not_a_fit", { reason: `r${i}` }));
    }
    const env = { SOLOMON_DB: makeFakeDb({ overrides }) };
    const r = await readJson(await handleScanSuggestions(postReq({}), env, OK));
    assert.equal(r.candidates, 1);
    assert.equal(r.created, 1);
    const list = await readJson(await handleListSuggestions(postReq({}), env, OK));
    assert.equal(list.items[0].occurrenceCount, 6000, "full count reported, no 5000-row ceiling");
  });

  it("15. /suggestion/decide writes status + decided_by + decided_at", async () => {
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
