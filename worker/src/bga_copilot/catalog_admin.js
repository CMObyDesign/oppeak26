// BGA Copilot — Service Catalog + Bundles admin handlers (slice B
// of 5; customer directive 2026-10-17).
//
// Slice A moved the catalog from a deploy-bundled JSON into D1
// (migration 0004_bga_service_catalog.sql); this slice adds the admin
// surface that authorized staff use to EDIT the catalog without a
// code deploy.
//
// Design rules the handlers enforce:
//   1. Published versions are IMMUTABLE. An admin "edit" always
//      creates a NEW `bga_catalog_versions` row and promotes it to
//      active; the previous row stays as-is so a stored case-level
//      `swot_bga_services_catalog_ref` keeps resolving.
//   2. Publish is ALL-OR-NOTHING. The version-insert, every
//      per-service insert, every per-bundle insert, and the
//      activation pointer update ride in a single D1 `batch([...])`,
//      so a partial failure cannot leave an inconsistent catalog
//      half-active (same discipline slice A applied to the first-
//      time seed; Codex P2 on #138).
//   3. Catalog SHA is CANONICAL. `services_sha` + `bundles_sha` are
//      computed from the submitted shape BEFORE the batch and stored
//      on the version row. Slice A's loader reads the stored SHA
//      verbatim instead of re-hashing hydrated rows, so case-level
//      refs stay comparable across admin edits (Codex P2 on #138).
//   4. The matcher cache is invalidated after a successful publish
//      via `_resetCatalogAdminCache(env)` — handlers that run on the
//      same isolate as the admin UI see the new version on their
//      next request (no need to wait for the 60s TTL to expire).
//
// Endpoints (all x-console-password-gated via checkPassword):
//   POST /asksolomon/catalog/active   → active version + its services + its bundles
//   POST /asksolomon/catalog/versions → version history (id, published_at, published_by, note, SHAs)
//   POST /asksolomon/catalog/version  → body: { versionId } → services + bundles for that version
//   POST /asksolomon/catalog/publish  → body: { note, publishedBy, services[], bundles[] } → new version id

import { json } from "./case_handlers.js";
import { invalidateServicesCatalogCache } from "./services_catalog.js";

// Canonical 12-hex short SHA-256. Mirrors the scheme in
// services_catalog.js so stored SHAs stay comparable between the
// loader and the publisher.
async function _shortSha(payload) {
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

// Normalize an admin-submitted service entry into the row shape the
// `bga_services` INSERT expects. All JSON-serialized columns are
// stringified here so the batch binding sees strings for every slot.
// Missing fields default to safe empties — admins SHOULD fill them,
// but a half-filled publish is better than a 400 that loses their
// in-flight edits. Validation that MUST stop a publish (missing
// service_id, missing name, bad shape) happens in the handler.
function _normalizeServiceInput(svc) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  return {
    service_id:                  String(svc.service_id || "").trim(),
    name:                        String(svc.name || "").trim(),
    problem_solved:              svc.problem_solved ? String(svc.problem_solved) : null,
    signals_relevant_json:       JSON.stringify(arr(svc.signals_relevant)),
    hard_block_rules_json:       JSON.stringify(arr(svc.hard_block_rules)),
    caution_rules_json:          JSON.stringify(arr(svc.caution_rules)),
    defer_rules_json:            JSON.stringify(arr(svc.defer_rules)),
    deliverables_json:           JSON.stringify(arr(svc.deliverables)),
    client_responsibility_json:  JSON.stringify(arr(svc.client_responsibility)),
    cfobd_responsibility_json:   JSON.stringify(arr(svc.cfobd_responsibility)),
    pricing_json:                JSON.stringify(obj(svc.pricing)),
    bundle_eligibility_json:     JSON.stringify(obj(svc.bundle_eligibility)),
    dependencies_json:           JSON.stringify(arr(svc.dependencies)),
    talking_points_json:         JSON.stringify(arr(svc.talking_points)),
    customer_value_points_json:  JSON.stringify(arr(svc.customer_value_points)),
  };
}

function _normalizeBundleInput(b) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  return {
    bundle_id:                 String(b.bundle_id || "").trim(),
    name:                      String(b.name || "").trim(),
    description:               b.description ? String(b.description) : null,
    included_service_ids_json: JSON.stringify(arr(b.included_service_ids)),
    pricing_json:              JSON.stringify(obj(b.pricing)),
  };
}

// Reads the active version (id + metadata + rows + bundles). Returns
// `{ active: null }` when no admin has published yet (bga_catalog_active
// still holds its seeded NULL pointer); the admin UI treats that as
// "nothing to edit yet — the first publish will create version 1."
async function _readActive(db) {
  const activePtr = await db
    .prepare("SELECT active_version_id FROM bga_catalog_active WHERE singleton = 1 LIMIT 1")
    .first();
  const versionId = activePtr && activePtr.active_version_id;
  if (!versionId) return { active: null };
  return await _readVersion(db, versionId);
}

async function _readVersion(db, versionId) {
  const versionRow = await db
    .prepare(
      `SELECT id, published_at, published_by, note, services_sha, bundles_sha, created_at
       FROM bga_catalog_versions WHERE id = ? LIMIT 1`
    )
    .bind(versionId)
    .first();
  if (!versionRow) return { active: null, versionId };
  const servicesRows = await db
    .prepare(
      `SELECT service_id, name, problem_solved,
              signals_relevant_json, hard_block_rules_json, caution_rules_json,
              defer_rules_json, deliverables_json, client_responsibility_json,
              cfobd_responsibility_json, pricing_json, bundle_eligibility_json,
              dependencies_json, talking_points_json, customer_value_points_json
       FROM bga_services WHERE version_id = ? AND is_active = 1
       ORDER BY service_id`
    )
    .bind(versionId)
    .all();
  const bundlesRows = await db
    .prepare(
      `SELECT bundle_id, name, description, included_service_ids_json, pricing_json
       FROM bga_bundles WHERE version_id = ? AND is_active = 1
       ORDER BY bundle_id`
    )
    .bind(versionId)
    .all();
  const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
  const services = (servicesRows.results || []).map((r) => ({
    service_id:            r.service_id,
    name:                  r.name,
    problem_solved:        r.problem_solved || "",
    signals_relevant:      parse(r.signals_relevant_json, []),
    hard_block_rules:      parse(r.hard_block_rules_json, []),
    caution_rules:         parse(r.caution_rules_json, []),
    defer_rules:           parse(r.defer_rules_json, []),
    deliverables:          parse(r.deliverables_json, []),
    client_responsibility: parse(r.client_responsibility_json, []),
    cfobd_responsibility:  parse(r.cfobd_responsibility_json, []),
    pricing:               parse(r.pricing_json, {}),
    bundle_eligibility:    parse(r.bundle_eligibility_json, {}),
    dependencies:          parse(r.dependencies_json, []),
    talking_points:        parse(r.talking_points_json, []),
    customer_value_points: parse(r.customer_value_points_json, []),
  }));
  const bundles = (bundlesRows.results || []).map((r) => ({
    bundle_id:            r.bundle_id,
    name:                 r.name,
    description:          r.description || "",
    included_service_ids: parse(r.included_service_ids_json, []),
    pricing:              parse(r.pricing_json, {}),
  }));
  return {
    active: {
      versionId:    versionRow.id,
      published_at: versionRow.published_at,
      published_by: versionRow.published_by,
      note:         versionRow.note || "",
      services_sha: versionRow.services_sha,
      bundles_sha:  versionRow.bundles_sha,
      created_at:   versionRow.created_at,
      services,
      bundles,
    },
  };
}

// POST /asksolomon/catalog/active — returns active version + rows + bundles.
export async function handleCatalogActive(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  const db = env && env.SOLOMON_DB;
  if (!db) return json({ success: false, error: "D1 unavailable" }, 503);
  try {
    const payload = await _readActive(db);
    return json({ success: true, ...payload });
  } catch (err) {
    return json({ success: false, error: `D1 read failed: ${err && err.message}` }, 503);
  }
}

// POST /asksolomon/catalog/versions — version history list.
export async function handleCatalogVersions(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  const db = env && env.SOLOMON_DB;
  if (!db) return json({ success: false, error: "D1 unavailable" }, 503);
  try {
    const activePtr = await db
      .prepare("SELECT active_version_id FROM bga_catalog_active WHERE singleton = 1 LIMIT 1")
      .first();
    const activeVersionId = activePtr && activePtr.active_version_id;
    const rows = await db
      .prepare(
        `SELECT id, published_at, published_by, note, services_sha, bundles_sha, created_at
         FROM bga_catalog_versions ORDER BY id DESC LIMIT 200`
      )
      .all();
    return json({
      success: true,
      activeVersionId: activeVersionId || null,
      versions: rows.results || [],
    });
  } catch (err) {
    return json({ success: false, error: `D1 read failed: ${err && err.message}` }, 503);
  }
}

// POST /asksolomon/catalog/version — body: { versionId } → that version's content.
export async function handleCatalogVersion(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }
  const versionId = Number(body.versionId);
  if (!Number.isInteger(versionId) || versionId <= 0) {
    return json({ success: false, error: "versionId must be a positive integer" }, 400);
  }
  const db = env && env.SOLOMON_DB;
  if (!db) return json({ success: false, error: "D1 unavailable" }, 503);
  try {
    const payload = await _readVersion(db, versionId);
    return json({ success: true, ...payload });
  } catch (err) {
    return json({ success: false, error: `D1 read failed: ${err && err.message}` }, 503);
  }
}

// POST /asksolomon/catalog/publish — creates a new version with the
// submitted services + bundles, promotes it to active.
//
// Body: {
//   note:        string (required — short rationale, "add new VF service", etc.),
//   publishedBy: string (required — operator email / handle),
//   services:    Array<Service>   — the FULL new catalog, not a diff
//   bundles:     Array<Bundle>    — the FULL new bundles list, not a diff
// }
//
// Full-snapshot semantics: whatever is in `services` and `bundles` IS
// the new version. A service omitted from the payload is NOT carried
// forward from the previous version — removal is "leave it out of the
// next publish." This keeps the publish operation idempotent and
// deterministic (replay the same payload → identical SHA).
export async function handleCatalogPublish(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const note        = typeof body.note === "string" ? body.note.trim() : "";
  const publishedBy = typeof body.publishedBy === "string" ? body.publishedBy.trim() : "";
  const services    = Array.isArray(body.services) ? body.services : null;
  const bundles     = Array.isArray(body.bundles)  ? body.bundles  : [];

  if (!note)              return json({ success: false, error: "note is required (short rationale)" }, 400);
  if (!publishedBy)       return json({ success: false, error: "publishedBy is required (operator identifier)" }, 400);
  if (services === null)  return json({ success: false, error: "services must be an array" }, 400);

  // Shape validation. Fail the whole publish on any bad row rather
  // than silently dropping it — the admin needs to know their edit
  // didn't land, and a half-written catalog is strictly worse than
  // a rejected one.
  const normServices = [];
  const seenServiceIds = new Set();
  for (let i = 0; i < services.length; i++) {
    const svc = services[i];
    if (!svc || typeof svc !== "object") {
      return json({ success: false, error: `services[${i}] is not an object` }, 400);
    }
    const n = _normalizeServiceInput(svc);
    if (!n.service_id) return json({ success: false, error: `services[${i}].service_id is required` }, 400);
    if (!n.name)       return json({ success: false, error: `services[${i}].name is required` }, 400);
    if (seenServiceIds.has(n.service_id)) {
      return json({ success: false, error: `duplicate services[].service_id: ${n.service_id}` }, 400);
    }
    seenServiceIds.add(n.service_id);
    normServices.push(n);
  }

  const normBundles = [];
  const seenBundleIds = new Set();
  for (let i = 0; i < bundles.length; i++) {
    const b = bundles[i];
    if (!b || typeof b !== "object") {
      return json({ success: false, error: `bundles[${i}] is not an object` }, 400);
    }
    const n = _normalizeBundleInput(b);
    if (!n.bundle_id) return json({ success: false, error: `bundles[${i}].bundle_id is required` }, 400);
    if (!n.name)      return json({ success: false, error: `bundles[${i}].name is required` }, 400);
    if (seenBundleIds.has(n.bundle_id)) {
      return json({ success: false, error: `duplicate bundles[].bundle_id: ${n.bundle_id}` }, 400);
    }
    seenBundleIds.add(n.bundle_id);
    normBundles.push(n);
  }

  // Compute SHAs on the SUBMITTED canonical shape (before INSERT, so
  // the stored `services_sha` is derived from exactly what the admin
  // sent, not from a round-tripped-through-D1 version of it).
  const servicesSha = await _shortSha(services);
  const bundlesSha  = await _shortSha(bundles);

  const db = env && env.SOLOMON_DB;
  if (!db) return json({ success: false, error: "D1 unavailable" }, 503);

  // Two-phase: (1) create the version row to get its id; (2) send
  // every row insert + the activation UPDATE in one batch. D1
  // doesn't support cross-statement transactions on the Workers
  // binding, but batch is all-or-nothing at the API layer, so if any
  // insert fails, the pointer never advances and the orphaned
  // version row is harmless (just an unused id).
  const nowIso = new Date().toISOString();
  let versionId;
  try {
    const verInsert = await db
      .prepare(
        `INSERT INTO bga_catalog_versions (published_at, published_by, note, services_sha, bundles_sha)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(nowIso, publishedBy, note, servicesSha, bundlesSha)
      .run();
    versionId = verInsert && verInsert.meta && verInsert.meta.last_row_id;
    if (!versionId) return json({ success: false, error: "version insert returned no id" }, 503);
  } catch (err) {
    return json({ success: false, error: `version insert failed: ${err && err.message}` }, 503);
  }

  const stmts = [];
  for (const s of normServices) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO bga_services (
             version_id, service_id, name, problem_solved,
             signals_relevant_json, hard_block_rules_json, caution_rules_json, defer_rules_json,
             deliverables_json, client_responsibility_json, cfobd_responsibility_json,
             pricing_json, bundle_eligibility_json, dependencies_json,
             talking_points_json, customer_value_points_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          versionId, s.service_id, s.name, s.problem_solved,
          s.signals_relevant_json, s.hard_block_rules_json, s.caution_rules_json, s.defer_rules_json,
          s.deliverables_json, s.client_responsibility_json, s.cfobd_responsibility_json,
          s.pricing_json, s.bundle_eligibility_json, s.dependencies_json,
          s.talking_points_json, s.customer_value_points_json
        )
    );
  }
  for (const b of normBundles) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO bga_bundles (version_id, bundle_id, name, description, included_service_ids_json, pricing_json)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(versionId, b.bundle_id, b.name, b.description, b.included_service_ids_json, b.pricing_json)
    );
  }
  stmts.push(
    db
      .prepare(
        `UPDATE bga_catalog_active
         SET active_version_id = ?, activated_at = ?, activated_by = ?
         WHERE singleton = 1`
      )
      .bind(versionId, nowIso, publishedBy)
  );

  try {
    if (typeof db.batch === "function") {
      await db.batch(stmts);
    } else {
      for (const s of stmts) { await s.run(); }
    }
  } catch (err) {
    return json({
      success: false,
      error: `publish batch failed; version ${versionId} created but NOT activated: ${err && err.message}`,
    }, 503);
  }

  // Invalidate the per-isolate loader cache so the next matcher /
  // red-team / roadmap call on this isolate reads the new version
  // instead of waiting out the 60s TTL.
  try { invalidateServicesCatalogCache(); } catch { /* best-effort */ }

  return json({
    success: true,
    versionId,
    activated_at: nowIso,
    activated_by: publishedBy,
    services_sha: servicesSha,
    bundles_sha:  bundlesSha,
    counts: { services: normServices.length, bundles: normBundles.length },
  });
}
