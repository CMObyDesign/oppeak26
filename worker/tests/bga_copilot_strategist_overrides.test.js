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

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  handleListOverrides,
  handleListOverridesAll,
  handleRecordOverride,
  handleRevokeOverride,
} from "../src/bga_copilot/strategist_overrides.js";
// Slice C fix (Codex P1 on #140): handler now does a direct D1
// catalog check instead of reading services_catalog cache. Fake D1
// below answers the new SELECT 1 FROM bga_services query.

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
  services = null,
  nextInsertId = 100,
} = {}) {
  // Default service set — covers the catalog-id presence check used
  // by handleRecordOverride under the new direct-D1 validation.
  const defaultServices = [
    { version_id: 1, service_id: "svc_vf" },
    { version_id: 1, service_id: "svc_growth" },
    { version_id: 7, service_id: "svc_vf" },
    { version_id: 7, service_id: "svc_growth" },
  ];
  const state = {
    activeVersionId,
    overrides: [...overrides],
    services:  Array.isArray(services) ? [...services] : defaultServices,
    nextInsertId,
  };
  function prepare(sql) {
    if (/FROM bga_catalog_active/i.test(sql)) {
      return { first: async () => ({ active_version_id: state.activeVersionId }) };
    }
    // Direct catalog-id existence check (Codex P1 on #140).
    if (/SELECT 1 AS present[\s\S]+FROM bga_services[\s\S]+WHERE version_id = \? AND service_id = \?/i.test(sql)) {
      return {
        bind: (vid, sid) => ({
          first: async () => {
            const hit = state.services.find((s) => s.version_id === vid && s.service_id === sid);
            return hit ? { present: 1 } : null;
          },
        }),
      };
    }
    // Paginated list (Codex P2 on #140). The handler builds the WHERE
    // clause dynamically, so match on the ORDER BY id DESC + LIMIT ?.
    if (/FROM bga_strategist_overrides[\s\S]+ORDER BY id DESC[\s\S]+LIMIT \?/i.test(sql)) {
      const includeRevoked = !/revoked_at IS NULL/.test(sql);
      const hasCursor      = /AND id < \?/.test(sql);
      return {
        bind: (...binds) => ({
          all: async () => {
            const contactId = binds[0];
            const after     = hasCursor ? binds[1] : null;
            const limit     = binds[binds.length - 1];
            let rows = state.overrides.filter((o) => o.contact_id === contactId);
            if (!includeRevoked) rows = rows.filter((o) => !o.revoked_at);
            if (after != null)   rows = rows.filter((o) => o.id < after);
            rows.sort((a, b) => b.id - a.id);
            return { results: rows.slice(0, limit) };
          },
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


describe("strategist_overrides handlers (slice C)", () => {

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
    assert.match(body.error, /not in catalog version/);
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

  it("Codex P1 on #140: /override validates service_id via D1 (not the catalog cache)", async () => {
    // Verifies the handler queries bga_services directly against the
    // version id it's about to pin to. The fake D1 above has svc_vf
    // at version_id=1 and version_id=7. If the active pointer says 7,
    // a service that exists only at v=1 should be rejected.
    const db = makeFakeDb({
      activeVersionId: 42,  // active pointer says 42
      services: [
        { version_id: 1, service_id: "svc_vf" },      // old version
        { version_id: 42, service_id: "svc_growth" }, // new version
      ],
    });
    const env = { SOLOMON_DB: db };
    // svc_vf exists in version 1 but NOT version 42. Must be rejected.
    const r = await handleRecordOverride(postReq({
      contactId: "c1", serviceId: "svc_vf", action: "include", by: "me",
    }), env, OK);
    assert.equal(r.status, 400);
    const b = await readJson(r);
    assert.match(b.error, /not in catalog version 42/);
    // svc_growth exists in version 42 → accepted.
    const r2 = await handleRecordOverride(postReq({
      contactId: "c1", serviceId: "svc_growth", action: "include", by: "me",
    }), env, OK);
    assert.equal(r2.status, 200);
    const b2 = await readJson(r2);
    assert.equal(b2.catalogVersionId, 42);
  });

  it("Codex P2 on #140: /overrides returns a nextCursor when there are more rows", async () => {
    // The fake D1's list query respects LIMIT. Add LIST_PAGE_SIZE+1
    // non-revoked rows for one contact; the first page's response
    // should carry a non-null nextCursor equal to the last row's id.
    const rows = [];
    for (let i = 1; i <= 501; i++) {
      rows.push({
        id: i, contact_id: "c_many", catalog_version_id: 1, service_id: "svc_vf", action: "include",
        reason: null, payload_json: "{}", created_by: "liz",
        created_at: `2026-10-18T01:${String(i).padStart(2, "0")}:00Z`,
        revoked_at: null, revoked_by: null,
      });
    }
    const env = { SOLOMON_DB: makeFakeDb({ overrides: rows }) };
    const r1 = await readJson(await handleListOverrides(postReq({ contactId: "c_many" }), env, OK));
    assert.equal(r1.overrides.length, 500);
    assert.ok(r1.nextCursor, "nextCursor must be present on first full page");
    // Resume → one remaining row, no further cursor.
    const r2 = await readJson(await handleListOverrides(postReq({ contactId: "c_many", after: r1.nextCursor }), env, OK));
    assert.equal(r2.overrides.length, 1);
    assert.equal(r2.nextCursor, null);
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
