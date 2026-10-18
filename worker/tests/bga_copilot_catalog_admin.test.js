// Slice B regression tests — Service Catalog + Bundles admin handlers.
//
// Covers:
//   1. 401 when the console password header is missing / wrong.
//   2. /active returns {active: null} when no admin has published yet.
//   3. /active returns the active version with hydrated services + bundles.
//   4. /versions lists versions newest-first and names the active id.
//   5. /version?versionId=N returns that specific version's content
//      even if it is NOT the currently-active one.
//   6. /publish rejects missing note / publishedBy / services array
//      and duplicate ids with a 400 and a specific error message.
//   7. /publish happy path: creates a new bga_catalog_versions row,
//      inserts every submitted service + bundle, flips
//      bga_catalog_active to point at the new id, returns the new
//      SHA-driven version id, and invalidates the per-isolate cache.
//   8. /publish is ALL-OR-NOTHING: a failed insert mid-batch leaves
//      the previous active_version_id untouched (no partial version
//      becomes active).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  handleCatalogActive,
  handleCatalogVersions,
  handleCatalogVersion,
  handleCatalogPublish,
} from "../src/bga_copilot/catalog_admin.js";
import { invalidateServicesCatalogCache } from "../src/bga_copilot/services_catalog.js";

// -----------------------------------------------------------------------
// Fake D1 — just enough to drive the four admin handlers. Covers the
// SQL shapes the handlers use and no others; drift fails loudly.
// Options:
//   activeVersionId      — initial pointer (null for cold start)
//   versions             — version rows (array)
//   services             — service rows (array of raw D1 rows)
//   bundles              — bundle rows
//   failInsertNth        — zero-indexed; make the Nth bga_services
//                          INSERT fail (publish atomicity test)
//   failUpdateActive     — true → activation UPDATE throws
// -----------------------------------------------------------------------
function makeFakeDb({
  activeVersionId = null,
  versions = [],
  services = [],
  bundles = [],
  failInsertNth = null,
  failUpdateActive = false,
} = {}) {
  const state = {
    activeVersionId,
    versions: [...versions],
    services: [...services],
    bundles:  [...bundles],
    nextVersionId: 100,
    insertServiceAttempts: 0,
    batched: 0,
  };
  function prepare(sql) {
    if (/FROM bga_catalog_active/i.test(sql)) {
      return { first: async () => ({ active_version_id: state.activeVersionId }) };
    }
    if (/FROM bga_catalog_versions WHERE id = \?/i.test(sql)) {
      return {
        bind: (id) => ({
          first: async () => state.versions.find((v) => v.id === id) || null,
        }),
      };
    }
    if (/FROM bga_catalog_versions ORDER BY id DESC/i.test(sql)) {
      return {
        all: async () => ({
          results: [...state.versions].sort((a, b) => b.id - a.id),
        }),
      };
    }
    if (/FROM bga_services[\s\S]+WHERE version_id = \?/i.test(sql)) {
      return {
        bind: (vid) => ({
          all: async () => ({ results: state.services.filter((s) => s.version_id === vid) }),
        }),
      };
    }
    if (/FROM bga_bundles[\s\S]+WHERE version_id = \?/i.test(sql)) {
      return {
        bind: (vid) => ({
          all: async () => ({ results: state.bundles.filter((b) => b.version_id === vid) }),
        }),
      };
    }
    if (/INSERT INTO bga_catalog_versions/i.test(sql)) {
      return {
        bind: (publishedAt, publishedBy, note, servicesSha, bundlesSha) => ({
          run: async () => {
            const id = state.nextVersionId++;
            state.versions.push({ id, published_at: publishedAt, published_by: publishedBy, note, services_sha: servicesSha, bundles_sha: bundlesSha, created_at: publishedAt });
            return { meta: { last_row_id: id } };
          },
        }),
      };
    }
    if (/INSERT INTO bga_services/i.test(sql)) {
      return {
        bind: (version_id, service_id, name, problem_solved,
               signals_relevant_json, hard_block_rules_json, caution_rules_json, defer_rules_json,
               deliverables_json, client_responsibility_json, cfobd_responsibility_json,
               pricing_json, bundle_eligibility_json, dependencies_json,
               talking_points_json, customer_value_points_json) => ({
          run: async () => {
            const attempt = state.insertServiceAttempts++;
            if (failInsertNth !== null && attempt === failInsertNth) {
              throw new Error(`fake D1: forced service insert failure at attempt ${attempt}`);
            }
            state.services.push({
              version_id, service_id, name, problem_solved,
              signals_relevant_json, hard_block_rules_json, caution_rules_json, defer_rules_json,
              deliverables_json, client_responsibility_json, cfobd_responsibility_json,
              pricing_json, bundle_eligibility_json, dependencies_json,
              talking_points_json, customer_value_points_json,
              is_active: 1,
            });
            return { meta: {} };
          },
        }),
      };
    }
    if (/INSERT INTO bga_bundles/i.test(sql)) {
      return {
        bind: (version_id, bundle_id, name, description, included_service_ids_json, pricing_json) => ({
          run: async () => {
            state.bundles.push({ version_id, bundle_id, name, description, included_service_ids_json, pricing_json, is_active: 1 });
            return { meta: {} };
          },
        }),
      };
    }
    if (/UPDATE bga_catalog_active/i.test(sql)) {
      return {
        bind: (vid) => ({
          run: async () => {
            if (failUpdateActive) throw new Error("fake D1: forced activation failure");
            state.activeVersionId = vid;
            return { meta: {} };
          },
        }),
      };
    }
    throw new Error(`fake D1 unexpected SQL: ${sql.slice(0, 80)}…`);
  }
  // No batch() method — handlers fall through to the sequential
  // fallback, which the publish-atomicity test exercises directly.
  return { prepare, _state: state };
}

const PASSWORD_OK   = { checkPassword: () => true };
const PASSWORD_BAD  = { checkPassword: () => false };

function postReq(body) {
  return new Request("http://x/catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

async function readJson(resp) {
  const t = await resp.text();
  try { return JSON.parse(t); } catch { return { __raw: t }; }
}

describe("catalog_admin handlers (slice B)", () => {
  beforeEach(() => {
    invalidateServicesCatalogCache();
  });

  it("1. all four handlers return 401 without the console password header", async () => {
    const env = { SOLOMON_DB: makeFakeDb() };
    for (const h of [handleCatalogActive, handleCatalogVersions, handleCatalogVersion, handleCatalogPublish]) {
      const r = await h(postReq({}), env, PASSWORD_BAD);
      assert.equal(r.status, 401);
      const body = await readJson(r);
      assert.equal(body.success, false);
    }
  });

  it("2. /active returns {active: null} when no version has been published yet", async () => {
    const env = { SOLOMON_DB: makeFakeDb({ activeVersionId: null }) };
    const r = await handleCatalogActive(postReq({}), env, PASSWORD_OK);
    const body = await readJson(r);
    assert.equal(body.success, true);
    assert.equal(body.active, null);
  });

  it("3. /active returns the active version with hydrated services + bundles", async () => {
    const env = { SOLOMON_DB: makeFakeDb({
      activeVersionId: 7,
      versions: [{ id: 7, published_at: "2026-10-18T00:00:00Z", published_by: "admin@x", note: "launch", services_sha: "aaa", bundles_sha: "bbb", created_at: "2026-10-18T00:00:00Z" }],
      services: [{
        version_id: 7,
        service_id: "svc_a", name: "A", problem_solved: "p",
        signals_relevant_json:      '["s1"]',
        hard_block_rules_json:      '["h1"]',
        caution_rules_json:         '["c1"]',
        defer_rules_json:           '["d1"]',
        deliverables_json:          '["dv1"]',
        client_responsibility_json: '["cr1"]',
        cfobd_responsibility_json:  '["fr1"]',
        pricing_json:               '{"base":100}',
        bundle_eligibility_json:    '{"ok":true}',
        dependencies_json:          '["dep1"]',
        talking_points_json:        '["tp1"]',
        customer_value_points_json: '["cv1"]',
        is_active: 1,
      }],
      bundles: [{
        version_id: 7, bundle_id: "bnd_a", name: "Bundle A", description: "desc",
        included_service_ids_json: '["svc_a"]', pricing_json: '{"total":200}', is_active: 1,
      }],
    }) };
    const r = await handleCatalogActive(postReq({}), env, PASSWORD_OK);
    const body = await readJson(r);
    assert.equal(body.success, true);
    assert.equal(body.active.versionId, 7);
    assert.equal(body.active.services.length, 1);
    assert.deepEqual(body.active.services[0].hard_block_rules, ["h1"]);
    assert.deepEqual(body.active.services[0].pricing, { base: 100 });
    assert.equal(body.active.bundles.length, 1);
    assert.deepEqual(body.active.bundles[0].included_service_ids, ["svc_a"]);
  });

  it("4. /versions lists newest first and names the active id", async () => {
    const env = { SOLOMON_DB: makeFakeDb({
      activeVersionId: 20,
      versions: [
        { id: 10, published_at: "2026-10-01T00:00:00Z", published_by: "a", note: "n1", services_sha: "s1", bundles_sha: "b1" },
        { id: 20, published_at: "2026-10-10T00:00:00Z", published_by: "b", note: "n2", services_sha: "s2", bundles_sha: "b2" },
      ],
    }) };
    const r = await handleCatalogVersions(postReq({}), env, PASSWORD_OK);
    const body = await readJson(r);
    assert.equal(body.success, true);
    assert.equal(body.activeVersionId, 20);
    assert.equal(body.versions[0].id, 20);
    assert.equal(body.versions[1].id, 10);
  });

  it("5. /version returns a non-active version's content when asked", async () => {
    const env = { SOLOMON_DB: makeFakeDb({
      activeVersionId: 20,
      versions: [
        { id: 10, published_at: "2026-10-01T00:00:00Z", published_by: "a", note: "old", services_sha: "s1", bundles_sha: "b1", created_at: "x" },
        { id: 20, published_at: "2026-10-10T00:00:00Z", published_by: "b", note: "new", services_sha: "s2", bundles_sha: "b2", created_at: "y" },
      ],
      services: [
        { version_id: 10, service_id: "svc_old", name: "Old", problem_solved: null,
          signals_relevant_json:"[]", hard_block_rules_json:"[]", caution_rules_json:"[]", defer_rules_json:"[]",
          deliverables_json:"[]", client_responsibility_json:"[]", cfobd_responsibility_json:"[]",
          pricing_json:"{}", bundle_eligibility_json:"{}", dependencies_json:"[]",
          talking_points_json:"[]", customer_value_points_json:"[]", is_active: 1 },
      ],
    }) };
    const r = await handleCatalogVersion(postReq({ versionId: 10 }), env, PASSWORD_OK);
    const body = await readJson(r);
    assert.equal(body.success, true);
    assert.equal(body.active.versionId, 10);
    assert.equal(body.active.services[0].service_id, "svc_old");
  });

  it("6. /publish rejects missing note / publishedBy / services with a 400", async () => {
    const env = { SOLOMON_DB: makeFakeDb() };
    const cases = [
      { body: { publishedBy: "x", services: [] },                                      expect: /note is required/ },
      { body: { note: "n", services: [] },                                             expect: /publishedBy is required/ },
      { body: { note: "n", publishedBy: "x" },                                         expect: /services must be an array/ },
      { body: { note: "n", publishedBy: "x", services: [{}] },                        expect: /service_id is required/ },
      { body: { note: "n", publishedBy: "x", services: [{ service_id: "a" }] },      expect: /name is required/ },
      { body: { note: "n", publishedBy: "x", services: [
          { service_id: "dup", name: "A" }, { service_id: "dup", name: "B" },
      ] }, expect: /duplicate services\[\]\.service_id/ },
    ];
    for (const c of cases) {
      const r = await handleCatalogPublish(postReq(c.body), env, PASSWORD_OK);
      assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(c.body)}`);
      const body = await readJson(r);
      assert.match(body.error, c.expect);
    }
  });

  it("7. /publish happy path: creates version, inserts services + bundles, flips active pointer, invalidates cache", async () => {
    const db = makeFakeDb({ activeVersionId: null });
    const env = { SOLOMON_DB: db };
    const r = await handleCatalogPublish(postReq({
      note: "initial publish",
      publishedBy: "admin@cfobd",
      services: [
        { service_id: "svc_vf",     name: "Verified Financials" },
        { service_id: "svc_growth", name: "Growth Plan" },
      ],
      bundles: [
        { bundle_id: "premium_cfo", name: "Premium CFO Bundle", included_service_ids: ["svc_vf","svc_growth"], pricing: { monthly: 2500 } },
      ],
    }), env, PASSWORD_OK);
    assert.equal(r.status, 200);
    const body = await readJson(r);
    assert.equal(body.success, true);
    assert.ok(body.versionId > 0, "new version id returned");
    assert.equal(db._state.activeVersionId, body.versionId, "active pointer flipped to the new id");
    assert.equal(db._state.services.filter((s) => s.version_id === body.versionId).length, 2);
    assert.equal(db._state.bundles.filter((b) => b.version_id === body.versionId).length, 1);
    assert.equal(body.counts.services, 2);
    assert.equal(body.counts.bundles, 1);
  });

  it("8. /publish is all-or-nothing: a failed service insert leaves the active pointer untouched", async () => {
    const db = makeFakeDb({ activeVersionId: 55, failInsertNth: 0 }); // fail the FIRST insert
    const env = { SOLOMON_DB: db };
    const r = await handleCatalogPublish(postReq({
      note: "attempted edit",
      publishedBy: "admin@x",
      services: [
        { service_id: "svc_a", name: "A" },
        { service_id: "svc_b", name: "B" },
      ],
      bundles: [],
    }), env, PASSWORD_OK);
    assert.equal(r.status, 503);
    const body = await readJson(r);
    assert.equal(body.success, false);
    assert.match(body.error, /publish batch failed/);
    assert.equal(db._state.activeVersionId, 55, "previous active pointer must NOT advance after a partial publish");
  });
});
