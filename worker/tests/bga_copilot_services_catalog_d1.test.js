// Slice A regression tests — D1-backed services catalog loader.
//
// Covers:
//   1. JSON fallback when env is missing (console runs / tests).
//   2. JSON fallback when D1 is unreachable (DB throws).
//   3. First-time seed: empty bga_catalog_active + empty bga_services
//      populates from bundled JSON and promotes to active version 1.
//   4. Primed cache: a second request on the same isolate reuses the
//      cached row set without re-hitting D1.
//   5. _effectiveCatalog() sync accessor returns the primed D1 rows
//      after a prime call, not the bundled JSON.
//   6. _setCatalogForTests() still overrides everything (test harness
//      compatibility).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  primeServicesCatalog,
  getServicesCatalog,
  getServicesCatalogVersion,
  _effectiveCatalog,
  _setCatalogForTests,
  _resetCacheForTests,
} from "../src/bga_copilot/services_catalog.js";

// Minimal fake D1. Supports prepare/bind/first/all/run with the exact
// query shapes the loader uses; everything else throws so a drift in
// the loader's queries fails loudly instead of silently matching.
function makeFakeDb({ activeVersionId = null, services = [], throwOn = null } = {}) {
  const state = {
    activeVersionId,
    services: [...services],
    versions: [],
    nextVersionId: 100,
    reads: 0,
    writes: 0,
  };
  if (activeVersionId) {
    state.versions.push({ id: activeVersionId, published_at: "2026-01-01T00:00:00Z", published_by: "test" });
  }
  function prepare(sql) {
    if (throwOn && sql.includes(throwOn)) {
      return { bind: () => ({ first: async () => { throw new Error("D1 outage"); }, all: async () => { throw new Error("D1 outage"); }, run: async () => { throw new Error("D1 outage"); } }), first: async () => { throw new Error("D1 outage"); }, all: async () => { throw new Error("D1 outage"); }, run: async () => { throw new Error("D1 outage"); } };
    }
    if (/FROM bga_catalog_active/i.test(sql)) {
      return { first: async () => { state.reads++; return { active_version_id: state.activeVersionId }; } };
    }
    if (/FROM bga_services[\s\S]+WHERE version_id = \?/i.test(sql)) {
      return {
        bind: (vid) => ({
          all: async () => {
            state.reads++;
            return { results: state.services.filter(s => s.version_id === vid) };
          },
        }),
      };
    }
    if (/INSERT INTO bga_catalog_versions/i.test(sql)) {
      return {
        bind: (publishedAt, servicesSha, bundlesSha) => ({
          run: async () => {
            state.writes++;
            const id = state.nextVersionId++;
            state.versions.push({ id, published_at: publishedAt, services_sha: servicesSha, bundles_sha: bundlesSha });
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
            state.writes++;
            state.services.push({
              version_id, service_id, name, problem_solved,
              signals_relevant_json, hard_block_rules_json, caution_rules_json, defer_rules_json,
              deliverables_json, client_responsibility_json, cfobd_responsibility_json,
              pricing_json, bundle_eligibility_json, dependencies_json,
              talking_points_json, customer_value_points_json,
            });
            return { meta: {} };
          },
        }),
      };
    }
    if (/UPDATE bga_catalog_active/i.test(sql)) {
      return {
        bind: (versionId) => ({
          run: async () => {
            state.writes++;
            state.activeVersionId = versionId;
            return { meta: {} };
          },
        }),
      };
    }
    throw new Error(`fake D1: unexpected SQL: ${sql.slice(0, 80)}…`);
  }
  return { prepare, _state: state };
}

describe("services_catalog D1 loader (slice A)", () => {
  beforeEach(() => {
    _setCatalogForTests(null);
    _resetCacheForTests();
  });

  it("1. falls back to bundled JSON when env is missing", async () => {
    const list = await getServicesCatalog(undefined);
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 1, "bundled JSON has at least one placeholder service");
    const ver = await getServicesCatalogVersion(undefined);
    assert.match(ver, /^[0-9a-f]{12}$/, "version is 12-hex short SHA");
  });

  it("2. falls back to bundled JSON when D1 throws", async () => {
    const db = makeFakeDb({ throwOn: "FROM bga_catalog_active" });
    const list = await getServicesCatalog({ SOLOMON_DB: db });
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 1);
  });

  it("3. first-time seed: empty D1 populates from bundled JSON and activates version 1", async () => {
    const db = makeFakeDb({ activeVersionId: null, services: [] });
    const list = await getServicesCatalog({ SOLOMON_DB: db });
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 1, "seeded row set is non-empty");
    assert.ok(db._state.activeVersionId, "a version was promoted to active");
    assert.ok(db._state.writes > 0, "writes happened (seed INSERTs)");
  });

  it("4. second request on same isolate hits the cache, not D1", async () => {
    const db = makeFakeDb({ activeVersionId: 42, services: [
      makeRow(42, "svc_test", "Test Service"),
    ] });
    await getServicesCatalog({ SOLOMON_DB: db });
    const readsAfterFirst = db._state.reads;
    await getServicesCatalog({ SOLOMON_DB: db });
    const readsAfterSecond = db._state.reads;
    assert.equal(readsAfterSecond, readsAfterFirst, "second call used cache, no new D1 reads");
  });

  it("5. _effectiveCatalog() sync accessor returns primed D1 rows after a prime call", async () => {
    const db = makeFakeDb({ activeVersionId: 7, services: [
      makeRow(7, "svc_a", "Primed Service A"),
      makeRow(7, "svc_b", "Primed Service B"),
    ] });
    // Before priming, sync accessor returns bundled JSON.
    const before = _effectiveCatalog();
    assert.ok(Array.isArray(before));
    // Prime, then re-check.
    await primeServicesCatalog({ SOLOMON_DB: db });
    const after = _effectiveCatalog();
    assert.equal(after.length, 2, "primed D1 rows now served synchronously");
    assert.equal(after[0].service_id, "svc_a");
    assert.equal(after[1].service_id, "svc_b");
  });

  it("6. _setCatalogForTests() still overrides everything (test harness compatibility)", async () => {
    _setCatalogForTests([{ service_id: "svc_override", name: "Override" }]);
    const db = makeFakeDb({ activeVersionId: 1, services: [makeRow(1, "svc_db", "Db Service")] });
    const list = await getServicesCatalog({ SOLOMON_DB: db });
    assert.equal(list.length, 1);
    assert.equal(list[0].service_id, "svc_override");
    const sync = _effectiveCatalog();
    assert.equal(sync[0].service_id, "svc_override");
  });

  it("7. hard_block_rules / caution_rules / defer_rules hydrate on the service shape", async () => {
    const db = makeFakeDb({
      activeVersionId: 10,
      services: [{
        version_id: 10,
        service_id: "svc_rules",
        name: "Rules Service",
        problem_solved: "test",
        signals_relevant_json: '["sig_a"]',
        hard_block_rules_json: '["active_tax_default"]',
        caution_rules_json:    '["low_cash_reserve"]',
        defer_rules_json:      '["new_business"]',
        deliverables_json: "[]",
        client_responsibility_json: "[]",
        cfobd_responsibility_json: "[]",
        pricing_json: "{}",
        bundle_eligibility_json: "{}",
        dependencies_json: "[]",
        talking_points_json: "[]",
        customer_value_points_json: '["Clear financial direction"]',
      }],
    });
    const list = await getServicesCatalog({ SOLOMON_DB: db });
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].hard_block_rules, ["active_tax_default"]);
    assert.deepEqual(list[0].caution_rules,    ["low_cash_reserve"]);
    assert.deepEqual(list[0].defer_rules,      ["new_business"]);
    assert.deepEqual(list[0].customer_value_points, ["Clear financial direction"]);
    // Backwards compat: legacy field name still works for callers that
    // read `when_not_to_recommend`.
    assert.deepEqual(list[0].when_not_to_recommend, ["active_tax_default"]);
  });
});

function makeRow(version_id, service_id, name) {
  return {
    version_id,
    service_id,
    name,
    problem_solved: null,
    signals_relevant_json: "[]",
    hard_block_rules_json: "[]",
    caution_rules_json: "[]",
    defer_rules_json: "[]",
    deliverables_json: "[]",
    client_responsibility_json: "[]",
    cfobd_responsibility_json: "[]",
    pricing_json: "{}",
    bundle_eligibility_json: "{}",
    dependencies_json: "[]",
    talking_points_json: "[]",
    customer_value_points_json: "[]",
  };
}
