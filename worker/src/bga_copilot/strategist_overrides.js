// BGA Copilot — per-case strategist overrides (slice C of 5;
// customer directive 2026-10-17).
//
// Handlers for the `bga_strategist_overrides` table (migration 0005).
// Four endpoints, all password-gated via x-console-password:
//
//   POST /asksolomon/case/overrides        → list active overrides for a case
//   POST /asksolomon/case/override         → record a new override
//   POST /asksolomon/case/override/revoke  → soft-revoke an existing override
//   POST /asksolomon/case/overrides/all    → full history (incl. revoked) for a case
//
// Invariants the handlers enforce:
//   1. Every override is pinned to the catalog version that was
//      ACTIVE at override time. The service_id MUST exist in that
//      version's `bga_services` (except for `manual_add` — which
//      creates an ad-hoc id by definition), so a strategist can't
//      override against a service that isn't in the catalog they're
//      looking at.
//   2. Overrides are append-only. A "change of mind" is a NEW
//      override row; the old row is soft-revoked (`revoked_at` set),
//      so the audit trail stays complete for slice D's aggregator.
//   3. `defer` and `not_a_fit` REQUIRE a non-empty reason — those are
//      the actions whose signal the learning loop will consume, and
//      an unexplained rejection is useless for pattern mining.
//   4. These handlers DO NOT touch `swot_bga_services_selected` or
//      `swot_growth_plan` — approve-and-send keeps its contract and
//      ignores this table entirely.

import { json } from "./case_handlers.js";
import {
  primeServicesCatalog,
  _effectiveCatalog,
} from "./services_catalog.js";

const ACTIONS = new Set([
  "include",
  "defer",
  "not_a_fit",
  "manual_add",
  "edit_reason",
  "edit_dependencies",
]);
const ACTIONS_REQUIRING_REASON = new Set(["defer", "not_a_fit", "edit_reason"]);
// manual_add targets an ad-hoc id, so it bypasses the "must exist in
// the active catalog" check. Every other action targets a catalog id.
const ACTIONS_FOR_CATALOG_IDS = new Set([
  "include", "defer", "not_a_fit", "edit_reason", "edit_dependencies",
]);

// Resolve the catalog version that was active when the override was
// created. We ask D1 directly rather than relying on
// `getServicesCatalogVersion`'s short SHA — the override table joins
// on the numeric version id (FK), so we need the id, not the SHA.
async function _activeCatalogVersionId(env) {
  const db = env && env.SOLOMON_DB;
  if (!db) return null;
  try {
    const row = await db
      .prepare("SELECT active_version_id FROM bga_catalog_active WHERE singleton = 1 LIMIT 1")
      .first();
    return (row && row.active_version_id) || null;
  } catch {
    return null;
  }
}

function _parsePayload(row) {
  try { return JSON.parse(row.payload_json || "{}"); } catch { return {}; }
}

function _mapRow(row) {
  return {
    id:                  row.id,
    contactId:           row.contact_id,
    catalogVersionId:    row.catalog_version_id,
    serviceId:           row.service_id,
    action:              row.action,
    reason:              row.reason || "",
    payload:             _parsePayload(row),
    createdBy:           row.created_by,
    createdAt:           row.created_at,
    revokedAt:           row.revoked_at || null,
    revokedBy:           row.revoked_by || null,
  };
}

async function _listForContact(env, contactId, { includeRevoked = false } = {}) {
  const db = env.SOLOMON_DB;
  const where = includeRevoked
    ? "WHERE contact_id = ?"
    : "WHERE contact_id = ? AND revoked_at IS NULL";
  const rows = await db
    .prepare(
      `SELECT id, contact_id, catalog_version_id, service_id, action, reason,
              payload_json, created_by, created_at, revoked_at, revoked_by
       FROM bga_strategist_overrides
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT 500`
    )
    .bind(contactId)
    .all();
  return (rows.results || []).map(_mapRow);
}

// POST /asksolomon/case/overrides — list active overrides for one case.
export async function handleListOverrides(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  if (!contactId) return json({ success: false, error: "contactId required" }, 400);

  const db = env && env.SOLOMON_DB;
  if (!db) return json({ success: false, error: "D1 unavailable" }, 503);

  try {
    const overrides = await _listForContact(env, contactId);
    const activeVersionId = await _activeCatalogVersionId(env);
    return json({ success: true, overrides, activeCatalogVersionId: activeVersionId || null });
  } catch (err) {
    return json({ success: false, error: `D1 read failed: ${err && err.message}` }, 503);
  }
}

// POST /asksolomon/case/overrides/all — full history (incl. revoked)
// for a case. Separate route so operators who want the audit trail
// can get it, but the default view is clean.
export async function handleListOverridesAll(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  if (!contactId) return json({ success: false, error: "contactId required" }, 400);

  const db = env && env.SOLOMON_DB;
  if (!db) return json({ success: false, error: "D1 unavailable" }, 503);

  try {
    const overrides = await _listForContact(env, contactId, { includeRevoked: true });
    const activeVersionId = await _activeCatalogVersionId(env);
    return json({ success: true, overrides, activeCatalogVersionId: activeVersionId || null });
  } catch (err) {
    return json({ success: false, error: `D1 read failed: ${err && err.message}` }, 503);
  }
}

// POST /asksolomon/case/override — record a new override.
//
// Body: {
//   contactId: string,
//   serviceId: string,
//   action:    "include" | "defer" | "not_a_fit" | "manual_add" | "edit_reason" | "edit_dependencies",
//   reason?:   string (REQUIRED when action is defer / not_a_fit / edit_reason),
//   payload?:  object (action-specific; shapes documented in the migration header),
//   by:        string (strategist identifier),
// }
export async function handleRecordOverride(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  const serviceId = typeof body.serviceId === "string" ? body.serviceId.trim() : "";
  const action    = typeof body.action === "string" ? body.action.trim() : "";
  const reason    = typeof body.reason === "string" ? body.reason.trim() : "";
  const createdBy = typeof body.by === "string" ? body.by.trim() : "";
  const payload   = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
    ? body.payload : {};

  if (!contactId) return json({ success: false, error: "contactId required" }, 400);
  if (!serviceId) return json({ success: false, error: "serviceId required" }, 400);
  if (!createdBy) return json({ success: false, error: "by (strategist identifier) required" }, 400);
  if (!ACTIONS.has(action)) {
    return json({ success: false, error: `action must be one of: ${[...ACTIONS].join(", ")}` }, 400);
  }
  if (ACTIONS_REQUIRING_REASON.has(action) && !reason) {
    return json({ success: false, error: `action "${action}" requires a non-empty reason` }, 400);
  }
  if (action === "manual_add" && (!payload.name || typeof payload.name !== "string")) {
    return json({ success: false, error: 'action "manual_add" requires payload.name' }, 400);
  }
  if (action === "edit_dependencies" && !Array.isArray(payload.deps)) {
    return json({ success: false, error: 'action "edit_dependencies" requires payload.deps (array)' }, 400);
  }

  const db = env && env.SOLOMON_DB;
  if (!db) return json({ success: false, error: "D1 unavailable" }, 503);

  // Pin the override to the catalog version active NOW. Prime first
  // so _effectiveCatalog() reflects D1 (not the bundled fallback), and
  // so the catalog-id check below runs against the real active rows.
  try { await primeServicesCatalog(env); } catch { /* best-effort; fall through */ }
  const catalogVersionId = await _activeCatalogVersionId(env);
  if (!catalogVersionId) {
    return json({
      success: false,
      error: "no active catalog version — publish one via /asksolomon/catalog first",
    }, 409);
  }

  // Non-manual actions must target a service_id that exists in the
  // active catalog version. manual_add is exempt by design.
  if (ACTIONS_FOR_CATALOG_IDS.has(action)) {
    const catalog = _effectiveCatalog() || [];
    const inCatalog = catalog.some((s) => s && s.service_id === serviceId);
    if (!inCatalog) {
      return json({
        success: false,
        error: `service_id "${serviceId}" is not in the active catalog version (${catalogVersionId}). Use action "manual_add" to record an ad-hoc service.`,
      }, 400);
    }
  }

  try {
    const result = await db
      .prepare(
        `INSERT INTO bga_strategist_overrides
           (contact_id, catalog_version_id, service_id, action, reason, payload_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        contactId,
        catalogVersionId,
        serviceId,
        action,
        reason || null,
        JSON.stringify(payload),
        createdBy
      )
      .run();
    const id = result && result.meta && result.meta.last_row_id;
    return json({
      success: true,
      id: id || null,
      catalogVersionId,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    return json({ success: false, error: `insert failed: ${err && err.message}` }, 503);
  }
}

// POST /asksolomon/case/override/revoke — soft-revoke an existing override.
// Body: { overrideId: number, by: string }
export async function handleRevokeOverride(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const overrideId = Number(body.overrideId);
  const revokedBy  = typeof body.by === "string" ? body.by.trim() : "";
  if (!Number.isInteger(overrideId) || overrideId <= 0) {
    return json({ success: false, error: "overrideId must be a positive integer" }, 400);
  }
  if (!revokedBy) return json({ success: false, error: "by (strategist identifier) required" }, 400);

  const db = env && env.SOLOMON_DB;
  if (!db) return json({ success: false, error: "D1 unavailable" }, 503);

  try {
    // Load the row so we can report whether it was already revoked
    // (idempotent-ish — repeated revoke calls succeed without
    // overwriting the first revoker's identity).
    const row = await db
      .prepare(
        `SELECT id, contact_id, revoked_at, revoked_by
         FROM bga_strategist_overrides
         WHERE id = ? LIMIT 1`
      )
      .bind(overrideId)
      .first();
    if (!row) return json({ success: false, error: `override ${overrideId} not found` }, 404);
    if (row.revoked_at) {
      return json({
        success: true,
        alreadyRevoked: true,
        revokedAt: row.revoked_at,
        revokedBy: row.revoked_by,
      });
    }
    const nowIso = new Date().toISOString();
    await db
      .prepare(
        `UPDATE bga_strategist_overrides
         SET revoked_at = ?, revoked_by = ?
         WHERE id = ? AND revoked_at IS NULL`
      )
      .bind(nowIso, revokedBy, overrideId)
      .run();
    return json({ success: true, revokedAt: nowIso, revokedBy });
  } catch (err) {
    return json({ success: false, error: `revoke failed: ${err && err.message}` }, 503);
  }
}
