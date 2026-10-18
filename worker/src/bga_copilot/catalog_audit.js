// BGA Copilot — catalog-ref audit (slice E of 5; final slice;
// customer directive 2026-10-17).
//
// Slices A–D moved the catalog into D1, built the admin surface,
// added per-case strategist overrides, and surfaced repeated
// patterns as pending rule suggestions. Slice E is the AUDIT loop:
// every paid_297 case should pin a `swot_bga_services_catalog_ref`
// value that matches a published `bga_catalog_versions.services_sha`.
// Cases that pre-date slice A, or that ran during a D1 outage, may
// carry a bundled-JSON fallback SHA that doesn't correspond to any
// stored version — the strategist needs to see those cases and the
// admin needs a one-click backfill to pin them to a known version.
//
// Two endpoints, both x-console-password-gated:
//   POST /asksolomon/catalog/audit            → scan cohort, classify, return report
//   POST /asksolomon/catalog/audit/backfill   → body: {contactId, catalogVersionId, by, note?}
//                                               → writes the catalog_ref field on that
//                                               contact, appends an audit entry to
//                                               swot_bga_version_history.
//
// Classification buckets (per paid_297 contact):
//   - "pinned_known":   catalog_ref matches a stored version's services_sha
//   - "pinned_unknown": catalog_ref is set, but doesn't match any version
//                       (likely a pre-slice-A JSON fallback SHA, or a
//                       SHA from a version that was later soft-deleted)
//   - "unpinned":       catalog_ref is empty — case never ran a BGA tool,
//                       or the ref was never written (bug)
//
// The audit is READ-ONLY by default. Backfill is a SEPARATE call and
// requires an explicit catalogVersionId + operator identifier, so a
// scan can never silently rewrite case history.

import { json } from "./case_handlers.js";
import {
  fetchGHLCustomFieldsCatalog,
  buildFieldKeyToIdMap,
} from "../ghl_catalog.js";
import {
  fetchGhlContact,
  readCustomField,
} from "./case_handlers.js";
import { writeFieldsAndAppendHistory } from "./version_history.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const PAID_297_TAG = "swot_paid_297";
const CATALOG_REF_FIELD_KEY = "swot_bga_services_catalog_ref";

/**
 * Fetches every paid_297 contact (same v2021-07-28 shape case_search
 * uses). Returns `{contacts, error}` — contacts is null on failure so
 * the caller can report 503 cleanly.
 */
async function _fetchPaid297Cohort(env) {
  if (!env.GHL_API_KEY)  return { contacts: null, error: "GHL_API_KEY not configured" };
  if (!env.GHL_LOCATION_ID) return { contacts: null, error: "GHL_LOCATION_ID not configured" };
  try {
    const res = await fetch(`${GHL_API_BASE}/contacts/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GHL_API_KEY}`,
        "Content-Type": "application/json",
        Version: "2021-07-28",
      },
      body: JSON.stringify({
        locationId: env.GHL_LOCATION_ID,
        pageLimit: 100,
        filters: [{ field: "tags", operator: "contains", value: PAID_297_TAG }],
        sort: [{ field: "dateUpdated", direction: "desc" }],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { contacts: null, error: `GHL search ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { contacts: Array.isArray(data?.contacts) ? data.contacts : [], error: null };
  } catch (err) {
    return { contacts: null, error: `GHL search error: ${err?.message || err}` };
  }
}

/**
 * Reads every stored version's services_sha so the audit classifier
 * can tell "known" from "unknown" refs. Returns a Set<string> for O(1)
 * membership checks.
 */
async function _knownShas(db) {
  if (!db) return new Set();
  const rows = (await db
    .prepare("SELECT services_sha FROM bga_catalog_versions")
    .all()).results || [];
  return new Set(rows.map((r) => r.services_sha).filter(Boolean));
}

// POST /asksolomon/catalog/audit — read-only cohort scan.
export async function handleAuditCatalogRefs(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  const db = env && env.SOLOMON_DB;
  if (!db) return json({ success: false, error: "D1 unavailable" }, 503);

  // Load the GHL custom-fields catalog so we can resolve catalog_ref
  // on each contact. Audit is useless without this — a missing catalog
  // means we can't tell "unset" from "set but unreadable".
  let catalog, idMap;
  try {
    catalog = await fetchGHLCustomFieldsCatalog(env);
    idMap = buildFieldKeyToIdMap(catalog);
  } catch (e) {
    return json({ success: false, error: `GHL fields catalog unavailable: ${e?.message || e}` }, 503);
  }

  const { contacts, error } = await _fetchPaid297Cohort(env);
  if (contacts == null) return json({ success: false, error }, 503);

  let known;
  try {
    known = await _knownShas(db);
  } catch (err) {
    return json({ success: false, error: `D1 read failed: ${err && err.message}` }, 503);
  }

  const buckets = { pinned_known: 0, pinned_unknown: 0, unpinned: 0 };
  const items = [];
  for (const c of contacts) {
    const refRaw = readCustomField(c, CATALOG_REF_FIELD_KEY, idMap);
    const ref = typeof refRaw === "string" ? refRaw.trim() : "";
    let bucket;
    if (!ref) bucket = "unpinned";
    else if (known.has(ref)) bucket = "pinned_known";
    else bucket = "pinned_unknown";
    buckets[bucket]++;
    items.push({
      contactId:        c.id || c.contactId || null,
      name:             c.contactName || c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || "",
      company:          c.companyName || "",
      email:            c.email || "",
      catalogRef:       ref || null,
      bucket,
      updatedAt:        c.dateUpdated || null,
    });
  }

  return json({
    success: true,
    scannedAt: new Date().toISOString(),
    knownVersionCount: known.size,
    totals: {
      ...buckets,
      scanned: contacts.length,
    },
    items,
  });
}

// POST /asksolomon/catalog/audit/backfill — pin ONE case to a version.
// Body: { contactId, catalogVersionId, by, note? }
//
// Writes the catalog_ref custom field on the contact and appends an
// audit entry to swot_bga_version_history via writeFieldsAndAppendHistory.
// A backfill is a legitimate strategist action — admin's eyes on the
// decision — so it goes through the sanctioned write path, not a raw
// GHL PUT.
export async function handleBackfillCatalogRef(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId        = typeof body.contactId === "string" ? body.contactId.trim() : "";
  const catalogVersionId = Number(body.catalogVersionId);
  const by               = typeof body.by === "string" ? body.by.trim() : "";
  const note             = typeof body.note === "string" ? body.note.trim() : "";

  if (!contactId) return json({ success: false, error: "contactId required" }, 400);
  if (!by)        return json({ success: false, error: "by (operator identifier) required" }, 400);
  if (!Number.isInteger(catalogVersionId) || catalogVersionId <= 0) {
    return json({ success: false, error: "catalogVersionId must be a positive integer" }, 400);
  }

  const db = env && env.SOLOMON_DB;
  if (!db) return json({ success: false, error: "D1 unavailable" }, 503);

  // Resolve the target version's services_sha so we write the same
  // canonical hash the loader stores. Rejecting unknown version ids
  // here protects against typos silently blanking a case's ref.
  let versionRow;
  try {
    versionRow = await db
      .prepare("SELECT id, services_sha FROM bga_catalog_versions WHERE id = ? LIMIT 1")
      .bind(catalogVersionId)
      .first();
  } catch (err) {
    return json({ success: false, error: `D1 read failed: ${err && err.message}` }, 503);
  }
  if (!versionRow) {
    return json({ success: false, error: `catalog version ${catalogVersionId} not found` }, 404);
  }
  const sha = versionRow.services_sha;
  if (!sha) {
    return json({ success: false, error: `catalog version ${catalogVersionId} has no services_sha` }, 503);
  }

  // Go through the sanctioned writer so the backfill appears in
  // swot_bga_version_history with a backfill-specific action tag.
  // The audit entry preserves who did the backfill, when, and
  // (through the catalog_ref field on the entry) the SHA they
  // chose to pin to.
  const result = await writeFieldsAndAppendHistory({
    contactId,
    fieldWrites:    [{ key: CATALOG_REF_FIELD_KEY, value: sha }],
    action:         `audit_backfill_catalog_ref:${by}${note ? ` (${note})` : ""}`,
    affectedFields: [CATALOG_REF_FIELD_KEY],
    catalogRef:     sha,
    env,
  });
  if (!result.success) {
    return json({
      success: false,
      error: result.error || "backfill write failed",
    }, result.status || 503);
  }
  return json({
    success: true,
    contactId,
    catalogVersionId,
    services_sha: sha,
    by,
    note: note || null,
    entriesAppended: result.entries_appended || 1,
  });
}
