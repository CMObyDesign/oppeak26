// GHL custom-fields catalog — shared across the Worker.
//
// GHL's /contacts/{id} endpoint returns customFields as bare {id, value}
// — the field metadata (name, fieldKey, dataType) lives on
// /locations/{loc}/customFields instead. We fetch that catalog once per
// Worker instance (5-min TTL) and callers hydrate / resolve against it.
//
// Extracted from worker/src/index.js so BGA Copilot case handlers can
// share the same cache instance. Module-level `_cache` is a module
// singleton — imports resolve to one copy, so index.js and
// case_handlers.js hit the same in-memory catalog.

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID_DEFAULT = "oLIENQCtGnt9U6gfLhE5";
const GHL_FIELD_CATALOG_TTL_MS = 5 * 60 * 1000;

let _cache = null;
let _fetchedAt = 0;

/**
 * Distinguished error class so callers can tell a real catalog fetch
 * failure (which should propagate as a retryable webhook error) from an
 * intentional empty catalog (no GHL creds configured, tolerable for
 * local / free-tier flows).
 */
export class GHLCatalogUnavailableError extends Error {
  constructor(msg) { super(msg); this.name = "GHLCatalogUnavailableError"; }
}

/**
 * Returns {id → {name, fieldKey, dataType}}. Empty object when
 * GHL_API_KEY is absent (local / free-tier). Throws
 * GHLCatalogUnavailableError on genuine failures when no cached copy
 * is available.
 */
export async function fetchGHLCustomFieldsCatalog(env) {
  if (!env.GHL_API_KEY) return {};
  const now = Date.now();
  if (_cache && (now - _fetchedAt) < GHL_FIELD_CATALOG_TTL_MS) {
    return _cache;
  }
  const locationId = env.GHL_LOCATION_ID || GHL_LOCATION_ID_DEFAULT;
  // model=contact is required by GHL's Get Custom Fields endpoint; without it
  // the API rejects the request and the catalog stays empty, so hydration
  // silently no-ops. Explicitly ask for contact-scoped fields.
  const url = `${GHL_API_BASE}/locations/${locationId}/customFields?model=contact`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.GHL_API_KEY}`,
        Version: "2021-07-28",
      },
    });
  } catch (e) {
    if (_cache) return _cache;
    throw new GHLCatalogUnavailableError(`network error: ${e?.message || e}`);
  }
  if (!res.ok) {
    if (_cache) {
      console.warn(`[fetchGHLCustomFieldsCatalog] ${res.status} — using cached catalog.`);
      return _cache;
    }
    const bodySnippet = (await res.text().catch(() => "")).slice(0, 300);
    throw new GHLCatalogUnavailableError(`status ${res.status}: ${bodySnippet}`);
  }
  const data = await res.json().catch(() => ({}));
  const list = data?.customFields || [];
  const map = {};
  for (const f of list) {
    if (f && f.id) {
      map[f.id] = {
        name: f.name || null,
        fieldKey: f.fieldKey || f.key || null,
        dataType: f.dataType || null,
      };
    }
  }
  _cache = map;
  _fetchedAt = now;
  return map;
}

/**
 * Invert a catalog ({id → meta}) into a lookup from bare field key
 * ("business_playbook") to id. Both "contact.business_playbook" and
 * the bare form are accepted upstream in GHL; here we strip the prefix
 * so handlers can call readCustomField(contact, "business_playbook", idMap).
 *
 * Fields in the catalog without a resolvable fieldKey (metadata is
 * sometimes partial on legacy custom fields) are dropped — the caller's
 * fallback path (match by fieldKey on the contact itself) still catches
 * them where GHL happens to echo one back.
 */
export function buildFieldKeyToIdMap(catalog) {
  const out = {};
  if (!catalog || typeof catalog !== "object") return out;
  for (const [id, meta] of Object.entries(catalog)) {
    if (!meta) continue;
    const key = meta.fieldKey || "";
    if (!key) continue;
    const bare = key.startsWith("contact.") ? key.slice("contact.".length) : key;
    if (bare) out[bare] = id;
  }
  return out;
}

/**
 * Test-only hook. Resets the module-local cache so tests can control
 * what fetchGHLCustomFieldsCatalog returns on a per-test basis without
 * worrying about leakage from earlier tests.
 */
export function _resetCatalogCacheForTests() {
  _cache = null;
  _fetchedAt = 0;
}
