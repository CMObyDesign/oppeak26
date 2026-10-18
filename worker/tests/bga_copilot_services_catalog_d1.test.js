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
//
// Options:
//   activeVersionId      — initial active version pointer (null for cold start)
//   services             — initial row set (array of pre-hydrated rows)
//   versions             — initial version rows (adds published_at / services_sha)
//   throwOn              — if a prepare()'d SQL includes this substring, every
//                          method on the statement throws (simulates D1 outage)
//   failInsertNth        — Codex P2 atomicity test: fail the Nth bga_services
//                          INSERT run() to simulate a partial seed. Zero-indexed.
function makeFakeDb({
  activeVersionId = null,
  services = [],
  versions = null,
  throwOn = null,
  failInsertNth = null,
} = {}) {
  const state = {
    activeVersionId,
    services: [...services],
    versions: Array.isArray(versions) ? [...versions] : [],
    nextVersionId: 100,
    reads: 0,
    writes: 0,
    insertAttempts: 0,
  };
  if (activeVersionId && !state.versions.find(v => v.id === activeVersionId)) {
    // Default: version row carries a stored services_sha so the loader
    // can read it. Tests that need a specific SHA pass `versions`
    // explicitly.
    state.versions.push({
      id: activeVersionId,
      published_at: "2026-01-01T00:00:00Z",
      published_by: "test",
      services_sha: "deadbeefcafe",
      bundles_sha: "0000beefcafe",
    });
  }
  function prepare(sql) {
    if (throwOn && sql.includes(throwOn)) {
      return { bind: () => ({ first: async () => { throw new Error("D1 outage"); }, all: async () => { throw new Error("D1 outage"); }, run: async () => { throw new Error("D1 outage"); } }), first: async () => { throw new Error("D1 outage"); }, all: async () => { throw new Error("D1 outage"); }, run: async () => { throw new Error("D1 outage"); } };
    }
    if (/FROM bga_catalog_active/i.test(sql)) {
      return { first: async () => { state.reads++; return { active_version_id: state.activeVersionId }; } };
    }
    // SELECT services_sha FROM bga_catalog_versions WHERE id = ? — the
    // post-#138 canonical-SHA lookup used in place of hashing rows.
    if (/FROM bga_catalog_versions[\s\S]+WHERE id = \?/i.test(sql)) {
      return {
        bind: (vid) => ({
          first: async () => {
            state.reads++;
            const v = state.versions.find(r => r.id === vid);
            return v ? { services_sha: v.services_sha } : null;
          },
        }),
      };
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
            const attempt = state.insertAttempts++;
            if (failInsertNth !== null && attempt === failInsertNth) {
              throw new Error(`fake D1: forced insert failure at attempt ${attempt}`);
            }
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
  // Intentionally NOT providing a `batch` method on the fake D1 — the
  // loader's seed path then takes its sequential-with-abort fallback,
  // which is the shape these unit tests exercise. The real D1 batch is
  // used in production; its all-or-nothing contract is what the
  // fallback emulates here.
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

  it("7. Codex P2 on #138: a failed seed insert aborts activation (no partial catalog)", async () => {
    // Fail the FIRST services INSERT. Expectation: no version is
    // promoted to active (pointer stays null), so the next request
    // retries the seed instead of being stuck on a half-populated
    // catalog forever.
    const db = makeFakeDb({ activeVersionId: null, services: [], failInsertNth: 0 });
    const list = await getServicesCatalog({ SOLOMON_DB: db });
    // The loader returned SOMETHING (bundled fallback) for this
    // request, but the active pointer must NOT be set.
    assert.ok(Array.isArray(list));
    assert.equal(db._state.activeVersionId, null, "active pointer must remain null after a partial seed");
  });

  it("8. Codex P2 on #138: the stored services_sha from the version row is preserved (not recomputed from hydrated rows)", async () => {
    // The hydrator re-shapes rows (adds hard_block_rules /
    // caution_rules / defer_rules / customer_value_points, sorts by
    // service_id), so hashing hydrated rows gives a different SHA
    // than the publisher stored on the version row. The loader must
    // return the stored SHA so case-level
    // `swot_bga_services_catalog_ref` values remain comparable across
    // the slice-A schema change.
    const STORED_SHA = "feedfacefeed";
    const db = makeFakeDb({
      activeVersionId: 55,
      versions: [{ id: 55, published_at: "2026-01-01T00:00:00Z", published_by: "test", services_sha: STORED_SHA, bundles_sha: "0" }],
      services: [makeRow(55, "svc_x", "X")],
    });
    const ver = await getServicesCatalogVersion({ SOLOMON_DB: db });
    assert.equal(ver, STORED_SHA, "the version row's services_sha must be returned verbatim");
  });

  it("9. hard_block_rules / caution_rules / defer_rules hydrate on the service shape", async () => {
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
