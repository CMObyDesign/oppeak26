// Slice C regression tests — per-case strategist overrides.
//
// Covers:
//   1. All four handlers 401 without the console password header.
//   2. /overrides returns {overrides: [], activeCatalogVersionId}
//      on an empty DB.
//   3. /override requires contactId / serviceId / action / by.
//   4. /override rejects an unknown action with a 400.
//   5. /override requires a non-empty reason when action is
//      defer / not_a_fit / edit_reason.
//   6. /override rejects a non-manual action whose serviceId is NOT
//      in the active catalog version.
//   7. /override happy path (include) inserts a row pinned to the
//      currently-active catalog_version_id and returns its id.
//   8. /override action=manual_add bypasses the "service_id must be
//      in the active catalog" check (payload.name required).
//   9. /override 409s when there is NO active catalog version.
//  10. /override/revoke sets revoked_at + revoked_by; a second
//      revoke returns {alreadyRevoked: true} without overwriting.
//  11. /overrides filters out revoked rows; /overrides/all shows them.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  handleListOverrides,
  handleListOverridesAll,
  handleRecordOverride,
  handleRevokeOverride,
} from "../src/bga_copilot/strategist_overrides.js";
import {
  _setCatalogForTests,
  invalidateServicesCatalogCache,
} from "../src/bga_copilot/services_catalog.js";

// -----------------------------------------------------------------------
// Fake D1 — supports the SQL the strategist_overrides handlers use.
// Options:
//   activeVersionId  — initial bga_catalog_active pointer (null → cold)
//   overrides        — initial override rows
//   nextInsertId     — autoincrement cursor
// -----------------------------------------------------------------------
function makeFakeDb({
  activeVersionId = 1,
  overrides = [],
  nextInsertId = 100,
} = {}) {
  const state = {
    activeVersionId,
    overrides: [...overrides],
    nextInsertId,
  };
  function prepare(sql) {
    if (/FROM bga_catalog_active/i.test(sql)) {
      return { first: async () => ({ active_version_id: state.activeVersionId }) };
    }
    if (/SELECT[\s\S]+FROM bga_strategist_overrides[\s\S]+WHERE contact_id = \? AND revoked_at IS NULL/i.test(sql)) {
      return {
        bind: (cid) => ({
          all: async () => ({
            results: state.overrides
              .filter((o) => o.contact_id === cid && !o.revoked_at)
              .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
          }),
        }),
      };
    }
    if (/SELECT[\s\S]+FROM bga_strategist_overrides[\s\S]+WHERE contact_id = \?/i.test(sql)) {
      return {
        bind: (cid) => ({
          all: async () => ({
            results: state.overrides
              .filter((o) => o.contact_id === cid)
              .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
          }),
        }),
      };
    }
    if (/SELECT id, contact_id, revoked_at, revoked_by[\s\S]+FROM bga_strategist_overrides[\s\S]+WHERE id = \?/i.test(sql)) {
      return {
        bind: (id) => ({
          first: async () => state.overrides.find((o) => o.id === id) || null,
        }),
      };
    }
    if (/INSERT INTO bga_strategist_overrides/i.test(sql)) {
      return {
        bind: (contact_id, catalog_version_id, service_id, action, reason, payload_json, created_by) => ({
          run: async () => {
            const id = state.nextInsertId++;
            state.overrides.push({
              id, contact_id, catalog_version_id, service_id, action,
              reason: reason || null, payload_json, created_by,
              created_at: new Date(2026, 9, 18, 0, state.nextInsertId).toISOString(),
              revoked_at: null, revoked_by: null,
            });
            return { meta: { last_row_id: id } };
          },
        }),
      };
    }
    if (/UPDATE bga_strategist_overrides[\s\S]+SET revoked_at/i.test(sql)) {
      return {
        bind: (ts, by, id) => ({
          run: async () => {
            const row = state.overrides.find((o) => o.id === id && !o.revoked_at);
            if (row) {
              row.revoked_at = ts;
              row.revoked_by = by;
            }
            return { meta: {} };
          },
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
  return new Request("http://x/override", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

async function readJson(resp) {
  const t = await resp.text();
  try { return JSON.parse(t); } catch { return { __raw: t }; }
}

// Fixture catalog — a controlled service set for the catalog-id check.
const FIXTURE_CATALOG = [
  { service_id: "svc_vf", name: "Verified Financials" },
  { service_id: "svc_growth", name: "Growth Plan" },
];

describe("strategist_overrides handlers (slice C)", () => {
  beforeEach(() => {
    invalidateServicesCatalogCache();
    _setCatalogForTests(FIXTURE_CATALOG);
  });

  it("1. all four handlers 401 without the password header", async () => {
    const env = { SOLOMON_DB: makeFakeDb() };
    for (const h of [handleListOverrides, handleListOverridesAll, handleRecordOverride, handleRevokeOverride]) {
      const r = await h(postReq({ contactId: "c1", overrideId: 1 }), env, BAD);
      assert.equal(r.status, 401);
    }
  });

  it("2. /overrides returns {overrides: [], activeCatalogVersionId} on empty DB", async () => {
    const env = { SOLOMON_DB: makeFakeDb({ activeVersionId: 42 }) };
    const r = await handleListOverrides(postReq({ contactId: "c1" }), env, OK);
    const body = await readJson(r);
    assert.equal(body.success, true);
    assert.deepEqual(body.overrides, []);
    assert.equal(body.activeCatalogVersionId, 42);
  });

  it("3. /override requires contactId / serviceId / action / by", async () => {
    const env = { SOLOMON_DB: makeFakeDb() };
    for (const [body, pat] of [
      [{}, /contactId required/],
      [{ contactId: "c1" }, /serviceId required/],
      [{ contactId: "c1", serviceId: "svc_vf" }, /by \(strategist identifier\) required/],
      [{ contactId: "c1", serviceId: "svc_vf", by: "me" }, /action must be one of/],
    ]) {
      const r = await handleRecordOverride(postReq(body), env, OK);
      assert.equal(r.status, 400);
      const parsed = await readJson(r);
      assert.match(parsed.error, pat);
    }
  });

  it("4. /override rejects an unknown action with a 400", async () => {
    const env = { SOLOMON_DB: makeFakeDb() };
    const r = await handleRecordOverride(postReq({
      contactId: "c1", serviceId: "svc_vf", action: "bogus", by: "me",
    }), env, OK);
    assert.equal(r.status, 400);
    const body = await readJson(r);
    assert.match(body.error, /action must be one of/);
  });

  it("5. /override requires reason for defer / not_a_fit / edit_reason", async () => {
    const env = { SOLOMON_DB: makeFakeDb() };
    for (const action of ["defer", "not_a_fit", "edit_reason"]) {
      const r = await handleRecordOverride(postReq({
        contactId: "c1", serviceId: "svc_vf", action, by: "me",
      }), env, OK);
      assert.equal(r.status, 400, `expected 400 for ${action} without reason`);
      const body = await readJson(r);
      assert.match(body.error, /requires a non-empty reason/);
    }
  });

  it("6. /override rejects a non-manual action whose serviceId is not in the active catalog", async () => {
    const env = { SOLOMON_DB: makeFakeDb({ activeVersionId: 1 }) };
    const r = await handleRecordOverride(postReq({
      contactId: "c1", serviceId: "svc_not_in_catalog", action: "include", by: "me",
    }), env, OK);
    assert.equal(r.status, 400);
    const body = await readJson(r);
    assert.match(body.error, /not in the active catalog version/);
  });

  it("7. /override happy path records a row pinned to the active catalog_version_id", async () => {
    const db = makeFakeDb({ activeVersionId: 7 });
    const env = { SOLOMON_DB: db };
    const r = await handleRecordOverride(postReq({
      contactId: "c1", serviceId: "svc_vf", action: "include", by: "liz@x",
    }), env, OK);
    assert.equal(r.status, 200);
    const body = await readJson(r);
    assert.equal(body.success, true);
    assert.ok(body.id > 0);
    assert.equal(body.catalogVersionId, 7);
    assert.equal(db._state.overrides.length, 1);
    const row = db._state.overrides[0];
    assert.equal(row.contact_id, "c1");
    assert.equal(row.catalog_version_id, 7);
    assert.equal(row.action, "include");
    assert.equal(row.created_by, "liz@x");
  });

  it("8. /override action=manual_add bypasses the catalog-id check (payload.name required)", async () => {
    const db = makeFakeDb({ activeVersionId: 7 });
    const env = { SOLOMON_DB: db };
    // Missing payload.name → 400.
    const bad = await handleRecordOverride(postReq({
      contactId: "c1", serviceId: "svc_adhoc", action: "manual_add", by: "me", payload: {},
    }), env, OK);
    assert.equal(bad.status, 400);
    const badBody = await readJson(bad);
    assert.match(badBody.error, /manual_add.*payload\.name/);
    // Happy path.
    const good = await handleRecordOverride(postReq({
      contactId: "c1", serviceId: "svc_adhoc_q4_bundle", action: "manual_add",
      by: "me", payload: { name: "Q4 CFO Bundle" },
    }), env, OK);
    assert.equal(good.status, 200);
    const goodBody = await readJson(good);
    assert.equal(goodBody.success, true);
    assert.equal(db._state.overrides.at(-1).service_id, "svc_adhoc_q4_bundle");
  });

  it("9. /override returns 409 when there is no active catalog version", async () => {
    const env = { SOLOMON_DB: makeFakeDb({ activeVersionId: null }) };
    const r = await handleRecordOverride(postReq({
      contactId: "c1", serviceId: "svc_vf", action: "include", by: "me",
    }), env, OK);
    assert.equal(r.status, 409);
    const body = await readJson(r);
    assert.match(body.error, /no active catalog version/);
  });

  it("10. /override/revoke soft-deletes; a second revoke is idempotent", async () => {
    const db = makeFakeDb({
      activeVersionId: 1,
      overrides: [{
        id: 500, contact_id: "c1", catalog_version_id: 1, service_id: "svc_vf", action: "include",
        reason: null, payload_json: "{}", created_by: "liz@x",
        created_at: "2026-10-18T00:00:00Z", revoked_at: null, revoked_by: null,
      }],
    });
    const env = { SOLOMON_DB: db };
    const r1 = await handleRevokeOverride(postReq({ overrideId: 500, by: "liz@x" }), env, OK);
    assert.equal(r1.status, 200);
    const b1 = await readJson(r1);
    assert.equal(b1.success, true);
    assert.equal(b1.revokedBy, "liz@x");
    assert.ok(b1.revokedAt);
    const r2 = await handleRevokeOverride(postReq({ overrideId: 500, by: "someone-else@x" }), env, OK);
    const b2 = await readJson(r2);
    assert.equal(b2.success, true);
    assert.equal(b2.alreadyRevoked, true);
    assert.equal(b2.revokedBy, "liz@x", "the ORIGINAL revoker's identity is preserved");
  });

  it("11. /overrides filters out revoked rows; /overrides/all shows them", async () => {
    const db = makeFakeDb({
      activeVersionId: 1,
      overrides: [
        { id: 1, contact_id: "c1", catalog_version_id: 1, service_id: "svc_vf", action: "include",
          reason: null, payload_json: "{}", created_by: "a", created_at: "2026-10-18T00:00:01Z",
          revoked_at: null, revoked_by: null },
        { id: 2, contact_id: "c1", catalog_version_id: 1, service_id: "svc_growth", action: "defer",
          reason: "too early", payload_json: "{}", created_by: "a", created_at: "2026-10-18T00:00:02Z",
          revoked_at: "2026-10-18T00:05:00Z", revoked_by: "b" },
      ],
    });
    const env = { SOLOMON_DB: db };
    const active = await readJson(await handleListOverrides(postReq({ contactId: "c1" }), env, OK));
    assert.equal(active.success, true);
    assert.equal(active.overrides.length, 1);
    assert.equal(active.overrides[0].id, 1);
    const all = await readJson(await handleListOverridesAll(postReq({ contactId: "c1" }), env, OK));
    assert.equal(all.success, true);
    assert.equal(all.overrides.length, 2);
  });
});
