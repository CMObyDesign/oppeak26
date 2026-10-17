// BGA Copilot — services catalog loader (customer directive 2026-10-17
// slice A; supersedes the deploy-bundled JSON reader from PR 6).
//
// The catalog now lives in D1 (tables created in migration
// 0004_bga_service_catalog.sql). Rows are grouped by `version_id`;
// only one version is `active` at a time (pointer row in
// bga_catalog_active). Published rows are immutable — any admin edit
// creates a new version and swaps the pointer.
//
// Backward-compat during rollout: when D1 has no active version yet
// (fresh deploy / brand-new DB), the loader seeds D1 from the bundled
// JSON (`worker/data/service_catalog.json`) and promotes that snapshot
// to active version 1. When D1 is UNREACHABLE (cold worker / DB
// outage), the loader falls back to the bundled JSON WITHOUT trying
// to seed, so a transient DB error can't take the matcher down.
//
// Public API:
//   - primeServicesCatalog(env)        — async; populates the per-isolate
//                                        cache from D1. Request handlers
//                                        call this once at the top so
//                                        downstream sync accessors see
//                                        the current D1 catalog. No-op
//                                        when env is unavailable or the
//                                        cache is already warm.
//   - getServicesCatalog(env?)         → Promise<Service[]>  (primes then returns)
//   - getServicesCatalogVersion(env?)  → Promise<string>  (12-hex short SHA)
//   - _effectiveCatalog()              → Service[]  (SYNC; returns the
//                                        last-primed row set, or the
//                                        bundled JSON if nothing primed).
//                                        Kept sync so match_services /
//                                        call_decisions / red_team_check
//                                        don't need to be rewritten.
//   - _setCatalogForTests(override)    — test-only hook (unchanged shape)
//
// Priming pattern: handlers that mutate or inspect per-case service
// decisions should call `await primeServicesCatalog(env)` at the top so
// subsequent sync `_effectiveCatalog()` reads inside matchServices /
// catalog-id validators / red-team checks reflect the current D1
// catalog, not the bundled fallback. Handlers that haven't been primed
// (console runs, deep-equal tests) see the bundled JSON — which is
// behaviorally identical to the pre-slice-A world.

import catalogJson from "../../data/service_catalog.json" with { type: "json" };

const BUNDLED_JSON_CATALOG = Array.isArray(catalogJson) ? catalogJson : [];

// Per-isolate cache. Catalog rows are small (dozens of services at
// most) and change rarely (admin edits publish a new version), so
// caching the active version for the isolate's lifetime is safe.
// Cleared automatically when the isolate recycles. Admins can force
// a reload by calling _resetCacheForTests() (test-only).
let _cache = { versionId: null, services: null, versionSha: null, loadedAt: 0 };
const CACHE_TTL_MS = 60 * 1000; // 60s: short enough that an admin publish is picked up quickly on the next request.

/**
 * Primes the per-isolate cache from D1. Idempotent + concurrency-safe:
 * concurrent callers converge on the same loaded snapshot via the
 * cache check. Safe to call from the top of every BGA request handler
 * without worrying about redundant D1 reads. No-op when env is missing.
 */
export async function primeServicesCatalog(env) {
  if (_testOverride) return;
  await _loadActiveVersion(env);
}

/**
 * Returns the currently-active services catalog as an array of
 * service objects. Shape matches the historical bundled-JSON entries
 * (plus the three new rule columns + customer_value_points) so
 * downstream matchers don't need to change. Primes the cache if cold.
 */
export async function getServicesCatalog(env) {
  if (_testOverride) return _testOverride;
  const row = await _loadActiveVersion(env);
  return row ? row.services : BUNDLED_JSON_CATALOG;
}

/**
 * Short SHA (12 hex) of the effective catalog, recorded on every BGA
 * case via `swot_bga_services_catalog_ref`. Reads from the active
 * version row when D1 is reachable; falls back to hashing the bundled
 * JSON otherwise, so case-level catalog refs remain stable + comparable
 * even during a transient DB outage.
 */
export async function getServicesCatalogVersion(env) {
  if (_testOverride) {
    return await _computeShortSha(_testOverride);
  }
  const row = await _loadActiveVersion(env);
  if (row && row.versionSha) return row.versionSha;
  return await _computeShortSha(BUNDLED_JSON_CATALOG);
}

/**
 * Test-only hook. Overrides the loaded catalog so tests exercise
 * matcher rules against a controlled fixture without touching D1 or
 * the committed JSON. Pass `null` to restore the real catalog.
 */
let _testOverride = null;
export function _setCatalogForTests(override) {
  _testOverride = override;
  _cache = { versionId: null, services: null, versionSha: null, loadedAt: 0 };
}

/**
 * SYNCHRONOUS catalog accessor — kept sync so match_services /
 * call_decisions / red_team_check don't need async rewrites. Returns
 * the last-primed D1 catalog if available, else the bundled JSON
 * fallback. Handlers that need current D1 data MUST call
 * `await primeServicesCatalog(env)` before invoking any code path
 * that reaches this function; without priming, this returns the
 * bundled JSON (behaviorally identical to pre-slice-A behavior).
 */
export function _effectiveCatalog() {
  if (_testOverride) return _testOverride;
  if (_cache.services && _cache.services.length) return _cache.services;
  return BUNDLED_JSON_CATALOG;
}

/**
 * D1 loader. Returns `{ versionId, services, versionSha }` when a row
 * set is available (either D1-active or JSON-seeded), or `null` when
 * D1 is unreachable AND the JSON fallback should be used by callers.
 * Honors the per-isolate cache (60s TTL).
 */
async function _loadActiveVersion(env) {
  const now = Date.now();
  if (_cache.services && (now - _cache.loadedAt) < CACHE_TTL_MS) {
    return _cache;
  }
  const db = env && env.SOLOMON_DB;
  if (!db) {
    // No DB binding (console runs, test harness without D1 mock). Caller
    // falls back to BUNDLED_JSON_CATALOG.
    return null;
  }

  try {
    const activeRow = await db
      .prepare("SELECT active_version_id FROM bga_catalog_active WHERE singleton = 1 LIMIT 1")
      .first();
    let versionId = activeRow && activeRow.active_version_id;

    if (!versionId) {
      // First-time seed from the bundled JSON. One admin can later
      // publish a new version via slice B; until then, D1 just mirrors
      // the shipped JSON so matcher behavior is identical to the old
      // module-import loader.
      versionId = await _seedFromBundledJson(db);
      if (!versionId) return null;
    }

    const rows = await db
      .prepare(
        `SELECT service_id, name, problem_solved,
                signals_relevant_json, hard_block_rules_json, caution_rules_json,
                defer_rules_json, deliverables_json, client_responsibility_json,
                cfobd_responsibility_json, pricing_json, bundle_eligibility_json,
                dependencies_json, talking_points_json, customer_value_points_json
         FROM bga_services
         WHERE version_id = ? AND is_active = 1
         ORDER BY service_id`
      )
      .bind(versionId)
      .all();

    const services = (rows && rows.results ? rows.results : []).map(_hydrateServiceRow);

    // Codex P2 on #138: don't recompute SHA from hydrated rows — the
    // hydrator shape differs from the stored on-disk JSON (adds the
    // three new rule arrays + customer_value_points, sorts by
    // service_id), so a hashed-after-hydrate SHA diverges from the
    // `services_sha` the publisher stored on the version row and from
    // the pre-migration JSON hash. Read the canonical SHA from the
    // version row and return THAT, so case-level
    // `swot_bga_services_catalog_ref` values stay comparable across
    // the schema change.
    const versionRow = await db
      .prepare("SELECT services_sha FROM bga_catalog_versions WHERE id = ? LIMIT 1")
      .bind(versionId)
      .first();
    const versionSha = (versionRow && versionRow.services_sha) || (await _computeShortSha(services));

    _cache = { versionId, services, versionSha, loadedAt: now };
    return _cache;
  } catch (err) {
    console.warn(`[services_catalog] D1 load failed, falling back to bundled JSON: ${err && err.message}`);
    return null;
  }
}

/**
 * One-shot seed on first access. Creates version 1 from the bundled
 * JSON and promotes it to active. Any failure returns null so the
 * caller falls back to JSON for THIS request; the next request will
 * retry the seed.
 */
async function _seedFromBundledJson(db) {
  const nowIso = new Date().toISOString();
  const servicesSha = await _computeShortSha(BUNDLED_JSON_CATALOG);
  const bundlesSha  = await _computeShortSha([]); // no bundle data in the legacy JSON

  try {
    // Insert the version row first so FK-dependent inserts can reference it.
    const versionInsert = await db
      .prepare(
        `INSERT INTO bga_catalog_versions (published_at, published_by, note, services_sha, bundles_sha)
         VALUES (?, 'seed', 'Seeded from bundled service_catalog.json on first D1 access.', ?, ?)`
      )
      .bind(nowIso, servicesSha, bundlesSha)
      .run();
    const versionId = versionInsert && versionInsert.meta && versionInsert.meta.last_row_id;
    if (!versionId) {
      console.warn("[services_catalog] seed: version insert returned no last_row_id");
      return null;
    }

    // Codex P2 on #138: all-or-nothing seed. If ANY service insert
    // fails, do NOT activate the partial version — leave
    // `bga_catalog_active.active_version_id` NULL so the next request
    // re-attempts the seed. Without this, one transient failure (or a
    // row-specific D1 error) permanently activates an incomplete
    // catalog, and the loader never retries because
    // `active_version_id` is no longer null.
    //
    // D1 doesn't support cross-statement transactions on the Workers
    // binding, but we DO have `batch([...])` which runs an array of
    // prepared statements as a single D1 operation. On binding error
    // (e.g. D1 outage mid-seed), the whole batch rejects and the
    // activation UPDATE in the same batch is NOT applied — the
    // version row remains orphaned (harmless; just an abandoned
    // catalog_versions id) and the pointer stays NULL for next-request
    // retry.
    const inserts = [];
    for (const svc of BUNDLED_JSON_CATALOG) {
      if (!svc || !svc.service_id || !svc.name) continue;
      inserts.push(
        db
          .prepare(
            `INSERT INTO bga_services (
               version_id, service_id, name, problem_solved,
               signals_relevant_json, hard_block_rules_json, caution_rules_json, defer_rules_json,
               deliverables_json, client_responsibility_json, cfobd_responsibility_json,
               pricing_json, bundle_eligibility_json, dependencies_json,
               talking_points_json, customer_value_points_json
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            versionId,
            svc.service_id,
            svc.name,
            svc.problem_solved || null,
            JSON.stringify(svc.signals_relevant || []),
            JSON.stringify(svc.when_not_to_recommend || []), // legacy field → hard_block_rules
            "[]", // caution_rules — empty on seed, admins add later in slice B
            "[]", // defer_rules   — empty on seed, admins add later in slice B
            JSON.stringify(svc.deliverables || []),
            JSON.stringify(svc.client_responsibility || []),
            JSON.stringify(svc.cfobd_responsibility || []),
            JSON.stringify(svc.pricing || {}),
            JSON.stringify(svc.bundle_eligibility || {}),
            JSON.stringify(svc.dependencies || []),
            JSON.stringify(svc.talking_points || []),
            "[]", // customer_value_points — empty on seed, admins add later in slice B
          )
      );
    }

    // Append the activation UPDATE as the final statement in the same
    // batch. D1's batch is all-or-nothing at the API level — any
    // statement failing rejects the whole call, so the activation only
    // sticks if every insert also stuck.
    const activate = db
      .prepare(
        `UPDATE bga_catalog_active
         SET active_version_id = ?, activated_at = ?, activated_by = 'seed'
         WHERE singleton = 1`
      )
      .bind(versionId, nowIso);

    if (typeof db.batch === "function") {
      try {
        await db.batch([...inserts, activate]);
      } catch (err) {
        console.warn(`[services_catalog] seed batch failed; NOT activating partial version ${versionId}: ${err && err.message}`);
        return null;
      }
    } else {
      // Test harnesses (fake D1) may not implement batch. Fall back
      // to sequential execution with explicit abort-on-first-failure
      // so the activation UPDATE never runs after an insert failure.
      for (const stmt of inserts) {
        try {
          await stmt.run();
        } catch (err) {
          console.warn(`[services_catalog] seed insert failed; NOT activating partial version ${versionId}: ${err && err.message}`);
          return null;
        }
      }
      try {
        await activate.run();
      } catch (err) {
        console.warn(`[services_catalog] seed activation failed for version ${versionId}: ${err && err.message}`);
        return null;
      }
    }

    console.log(`[services_catalog] seeded D1 from bundled JSON as version ${versionId} (${BUNDLED_JSON_CATALOG.length} services)`);
    return versionId;
  } catch (err) {
    console.warn(`[services_catalog] seed failed: ${err && err.message}`);
    return null;
  }
}

/** Row-to-service hydrator. Mirrors the shape downstream matchers
 *  already expect from the bundled JSON. */
function _hydrateServiceRow(row) {
  const parse = (s, fallback) => {
    try { return JSON.parse(s); } catch { return fallback; }
  };
  return {
    service_id:            row.service_id,
    name:                  row.name,
    problem_solved:        row.problem_solved || "",
    signals_relevant:      parse(row.signals_relevant_json, []),
    // Legacy field name preserved for callers that still read it.
    // New callers should prefer hard_block_rules / caution_rules /
    // defer_rules below.
    when_not_to_recommend: parse(row.hard_block_rules_json, []),
    hard_block_rules:      parse(row.hard_block_rules_json, []),
    caution_rules:         parse(row.caution_rules_json, []),
    defer_rules:           parse(row.defer_rules_json, []),
    deliverables:          parse(row.deliverables_json, []),
    client_responsibility: parse(row.client_responsibility_json, []),
    cfobd_responsibility:  parse(row.cfobd_responsibility_json, []),
    pricing:               parse(row.pricing_json, {}),
    bundle_eligibility:    parse(row.bundle_eligibility_json, {}),
    dependencies:          parse(row.dependencies_json, []),
    talking_points:        parse(row.talking_points_json, []),
    customer_value_points: parse(row.customer_value_points_json, []),
  };
}

/** 12-hex short SHA-256 — kept identical to the historical scheme so
 *  stored case-level `swot_bga_services_catalog_ref` values are
 *  comparable across the schema change. */
async function _computeShortSha(payload) {
  try {
    const text = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    const arr = new Uint8Array(buf);
    let out = "";
    for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, "0");
    return out.slice(0, 12);
  } catch {
    return "unknown";
  }
}

/** Test-only cache reset. Call after _setCatalogForTests() if you need
 *  the next getServicesCatalog() to re-fetch, or when the test harness
 *  swaps the D1 mock between cases. */
export function _resetCacheForTests() {
  _cache = { versionId: null, services: null, versionSha: null, loadedAt: 0 };
}
