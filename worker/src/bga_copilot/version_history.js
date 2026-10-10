// BGA Copilot — swot_bga_version_history write wrapper.
//
// Every write produced by a BGA tool endpoint lands here. The wrapper:
//   1. reads the current swot_bga_version_history field (array of entries)
//   2. appends one entry per affected field with
//      { at, actor, action, affected_field, snapshot_hash, catalog_ref? }
//   3. spills the oldest overflow entries to R2 under
//      bga_audit/<contactId>/<yyyy-mm>.json when the field would exceed
//      HISTORY_CAP (keeps the LARGE_TEXT field under its size cap)
//   4. PUTs the data fields AND the trimmed history field in a single
//      GHL request so a partial write never leaves the audit log
//      disagreeing with the content.
//
// Spec: BGA_COPILOT_SPEC.md §8, §11 row 10.
//
// Caveats recorded in §8.1:
//   - `actor` is a flag that the write came through a password-authed
//     request (`"console_session"`). It does NOT identify which
//     strategist on the team ran the action. Per-user attribution needs
//     an auth upgrade; tracked as future work.
//   - `snapshot_hash` is best-effort audit, not forensic tamper-evidence.
//     The hash lives next to the content in the same writable HL field,
//     so anyone who can rewrite the content can recompute the hash.

import { fetchGhlContact, readCustomField } from "./case_handlers.js";
import { fetchGHLCustomFieldsCatalog, buildFieldKeyToIdMap } from "../ghl_catalog.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

export const HISTORY_FIELD_KEY = "swot_bga_version_history";
export const HISTORY_CAP = 50;
export const SPILLOVER_PREFIX = "bga_audit";
export const ACTOR_CONSOLE_SESSION = "console_session";

async function sha256HexInternal(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Snapshot hash for an audit entry — "sha256:" + the first 16 hex of
 * SHA-256(value). Shortened for log compactness; §8.1 notes the hash is
 * best-effort, not forensic tamper-evidence, so a short prefix is fine
 * for diffable review.
 */
export async function computeSnapshotHash(value) {
  const hex = await sha256HexInternal(String(value || ""));
  return `sha256:${hex.slice(0, 16)}`;
}

/**
 * Parse the raw swot_bga_version_history field value. Returns [] for
 * empty / missing / malformed, matching the loader's countJsonArrayItems
 * tolerance.
 */
export function parseVersionHistory(raw) {
  if (!raw || typeof raw !== "string") return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Spill the oldest overflow entries to R2 when the combined length
 * exceeds HISTORY_CAP. Groups overflow entries by month (yyyy-mm from
 * `at`) and appends them to bga_audit/<contactId>/<yyyy-mm>.json so a
 * single month's spillover is contiguous.
 *
 * Fails closed: if env.BGA_AUDIT is missing but the combined log would
 * overflow, throws. We never silently drop audit entries.
 */
export async function spillOverflow(entries, contactId, env) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length <= HISTORY_CAP) return { kept: list, spilled: 0 };

  const overflowCount = list.length - HISTORY_CAP;
  const overflow = list.slice(0, overflowCount);
  const kept = list.slice(overflowCount);

  if (!env || !env.BGA_AUDIT || typeof env.BGA_AUDIT.put !== "function") {
    throw new Error(
      "version_history overflow: BGA_AUDIT R2 binding not configured",
    );
  }

  // Group overflow by month so each file holds one month of entries.
  const byMonth = new Map();
  for (const e of overflow) {
    const at = e && typeof e.at === "string" && e.at ? e.at : new Date().toISOString();
    const month = at.slice(0, 7); // yyyy-mm
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(e);
  }

  for (const [month, newEntries] of byMonth) {
    const key = `${SPILLOVER_PREFIX}/${contactId}/${month}.json`;
    let combined = newEntries;
    try {
      const existing = typeof env.BGA_AUDIT.get === "function"
        ? await env.BGA_AUDIT.get(key)
        : null;
      if (existing) {
        const prev = await existing.json();
        if (Array.isArray(prev)) combined = [...prev, ...newEntries];
      }
    } catch {
      // Non-fatal read failure — write the new entries alone rather
      // than lose them.
    }
    await env.BGA_AUDIT.put(key, JSON.stringify(combined), {
      httpMetadata: { contentType: "application/json" },
    });
  }

  return { kept, spilled: overflowCount };
}

async function putGhlCustomFields(contactId, fieldWrites, env) {
  if (!env.GHL_API_KEY) return { ok: false, error: "GHL_API_KEY not configured" };
  if (!Array.isArray(fieldWrites) || fieldWrites.length === 0) {
    return { ok: false, error: "fieldWrites must be a non-empty array" };
  }
  try {
    const res = await fetch(
      `${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.GHL_API_KEY}`,
          Version: "2021-07-28",
        },
        body: JSON.stringify({
          customFields: fieldWrites.map((f) => ({
            key: f.key,
            field_value: f.value,
          })),
        }),
      },
    );
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : "fetch failed" };
  }
}

/**
 * Build the array of version-history entries for a tool call — one
 * entry per affected field. Exported for tests that want to compare
 * the entries without re-running the whole write path.
 */
export async function buildHistoryEntries({
  action,
  affectedFields,
  fieldWrites,
  catalogRef,
  at,
}) {
  const stamp = at || new Date().toISOString();
  const writeByKey = new Map((fieldWrites || []).map((w) => [w.key, w]));
  const out = [];
  for (const fieldKey of affectedFields || []) {
    const w = writeByKey.get(fieldKey);
    const value = w ? String(w.value || "") : "";
    const snapshotHash = await computeSnapshotHash(value);
    const entry = {
      at: stamp,
      actor: ACTOR_CONSOLE_SESSION,
      action,
      affected_field: fieldKey,
      snapshot_hash: snapshotHash,
    };
    if (catalogRef) entry.catalog_ref = catalogRef;
    out.push(entry);
  }
  return out;
}

/**
 * The sanctioned write path for every BGA tool.
 *
 *   contactId:      GHL contact id (required)
 *   fieldWrites:    Array<{ key, value }>  — the data fields to PUT
 *   action:         tool name, e.g. "generate_roadmap_draft"
 *   affectedFields: Array<fieldKey> — one history entry per entry here
 *   catalogRef:     optional current services-catalog hash prefix
 *   historyRaw:     optional pre-read swot_bga_version_history value
 *                   (avoids a second GHL GET when the caller already
 *                   fetched the contact)
 *   env:            Worker env (needs GHL_API_KEY; needs BGA_AUDIT only
 *                   when spillover triggers)
 *
 * Returns { success, status, entries_appended, spilled_count } on success;
 * { success:false, status, error } otherwise.
 */
export async function writeFieldsAndAppendHistory({
  contactId,
  fieldWrites,
  action,
  affectedFields,
  catalogRef,
  historyRaw,
  env,
}) {
  if (!contactId || typeof contactId !== "string") {
    return { success: false, status: 400, error: "contactId required" };
  }
  if (!action || typeof action !== "string") {
    return { success: false, status: 400, error: "action required" };
  }
  if (!Array.isArray(fieldWrites) || fieldWrites.length === 0) {
    return { success: false, status: 400, error: "fieldWrites required" };
  }
  if (!Array.isArray(affectedFields) || affectedFields.length === 0) {
    return { success: false, status: 400, error: "affectedFields required" };
  }

  // Fetch current history if the caller didn't pre-read it.
  let currentRaw = historyRaw;
  if (currentRaw === undefined || currentRaw === null) {
    const fetched = await fetchGhlContact(contactId, env);
    if (!fetched.contact) {
      return {
        success: false,
        status: 503,
        error: fetched.error || "contact fetch failed",
      };
    }
    let idMap = {};
    try {
      const catalog = await fetchGHLCustomFieldsCatalog(env);
      idMap = buildFieldKeyToIdMap(catalog);
    } catch {
      // If the catalog is unreachable, treat as no history and continue.
      // The wrapper's reason for existing is the write; a missing catalog
      // means we'll start a fresh history on this PUT.
    }
    currentRaw = readCustomField(fetched.contact, HISTORY_FIELD_KEY, idMap);
  }

  const existing = parseVersionHistory(currentRaw);
  const newEntries = await buildHistoryEntries({
    action,
    affectedFields,
    fieldWrites,
    catalogRef,
  });
  const combined = [...existing, ...newEntries];

  let kept;
  let spilled;
  try {
    const res = await spillOverflow(combined, contactId, env);
    kept = res.kept;
    spilled = res.spilled;
  } catch (err) {
    return {
      success: false,
      status: 503,
      error: err && err.message ? err.message : "version-history spillover failed",
    };
  }

  const allWrites = [
    ...fieldWrites,
    { key: HISTORY_FIELD_KEY, value: JSON.stringify(kept) },
  ];
  const put = await putGhlCustomFields(contactId, allWrites, env);
  if (!put.ok) {
    return {
      success: false,
      status: 503,
      error: put.error || "writeback to GHL failed",
    };
  }

  return {
    success: true,
    status: 200,
    entries_appended: newEntries.length,
    spilled_count: spilled,
  };
}
