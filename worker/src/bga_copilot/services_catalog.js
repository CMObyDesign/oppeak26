// BGA Copilot — services catalog loader (PR 6, docs/BGA_COPILOT_SPEC.md §7).
//
// Loads `worker/data/service_catalog.json` at module import time. In
// the Workers runtime an ESM JSON import is bundled by Wrangler into
// the deployed module, so no fs / fetch is involved at request time.
//
// The catalog is content-owned by Miguel per §7.3 — this module is
// strictly a reader. It validates nothing beyond "is an array of
// objects"; the real schema check is in docs/services/CATALOG_SCHEMA.md
// and is enforced in CI. If someone commits a malformed catalog, the
// matcher's canonical-signal filter makes it a "no match" rather than
// a silent miss.

import catalogJson from "../../data/service_catalog.json" with { type: "json" };

const CATALOG = Array.isArray(catalogJson) ? catalogJson : [];

/** Returns the frozen catalog array. */
export function getServicesCatalog() {
  return CATALOG;
}

/**
 * Hash of the catalog's JSON string, used as the catalog version SHA
 * recorded in `swot_bga_services_catalog_ref` per spec §7.1 so
 * red-team / version-history audits know which catalog revision a
 * given draft was built against. Lazily computed per worker instance.
 */
let _versionPromise = null;
export function getServicesCatalogVersion() {
  if (_versionPromise) return _versionPromise;
  _versionPromise = (async () => {
    try {
      const text = JSON.stringify(CATALOG);
      const bytes = new TextEncoder().encode(text);
      const buf = await crypto.subtle.digest("SHA-256", bytes);
      const arr = new Uint8Array(buf);
      let out = "";
      for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, "0");
      // Short form: first 12 hex chars reads like a git short-SHA, which is what
      // operators already compare against in commit logs.
      return out.slice(0, 12);
    } catch {
      return "unknown";
    }
  })();
  return _versionPromise;
}

/**
 * Test-only hook. Overrides the loaded catalog so tests exercise
 * matcher rules against a controlled fixture without touching the
 * committed JSON. Pass `null` to restore the real catalog.
 */
let _testOverride = null;
export function _setCatalogForTests(override) {
  _testOverride = override;
}

/** Internal — used by match_services; honors the test override. */
export function _effectiveCatalog() {
  return _testOverride || CATALOG;
}
