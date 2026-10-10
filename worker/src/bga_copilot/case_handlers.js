// BGA Copilot case tool handlers.
//
// Two of the nine strategist-toolkit skills (per docs/BGA_COPILOT_SPEC.md
// §4) land in this module as PR 3 of the build:
//
//   [ FIND WHAT'S MISSING ]              audit_case_gaps
//   [ RECORD VERIFIED FINANCIALS ]       verified_financials_panel
//
// Both are password-gated via checkConsolePassword (x-console-password
// header). Both scoped to one contactId. Both write to internal fields
// only — neither can touch swot_growth_plan or apply
// swot_growth_plan_ready. Those writes are reserved for the APPROVE &
// SEND button endpoint shipped in PR 12.

import {
  CANONICAL_METRICS,
  CANONICAL_METRIC_IDS,
  isCanonicalMetric,
  validateVerifiedFinancialEntry,
  missingMetricIds,
  parseVerifiedFinancials,
  upsertEntry,
} from "./metrics.js";
import {
  fetchGHLCustomFieldsCatalog,
  buildFieldKeyToIdMap,
} from "../ghl_catalog.js";
import { hashVerifiedFinancialsRaw } from "./vf_hash.js";
import {
  HISTORY_FIELD_KEY,
  writeFieldsAndAppendHistory,
} from "./version_history.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const VERIFIED_FINANCIALS_FIELD_KEY = "swot_verified_financials";

/**
 * Minimal JSON response helper. The main Worker has its own json() but we
 * can't import that here without cycle risk; this is intentionally local.
 */
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Fetches a GHL contact by ID. Returns the parsed contact object, or
 * null if the fetch failed (404, non-ok, or network error). Caller
 * decides what to do with null; this function never throws for
 * network reasons.
 */
export async function fetchGhlContact(contactId, env) {
  if (!env.GHL_API_KEY) return { error: "GHL_API_KEY not configured", contact: null };
  let res;
  try {
    res = await fetch(`${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}`, {
      headers: {
        Authorization: `Bearer ${env.GHL_API_KEY}`,
        Version: "2021-07-28",
      },
    });
  } catch (err) {
    return { error: `GHL fetch failed: ${err?.message || err}`, contact: null };
  }
  if (res.status === 404) return { error: "contact not found", contact: null };
  if (!res.ok) return { error: `GHL returned ${res.status}`, contact: null };
  let data;
  try {
    data = await res.json();
  } catch {
    return { error: "GHL response was not JSON", contact: null };
  }
  const contact = data && data.contact;
  if (!contact) return { error: "GHL response missing contact", contact: null };
  return { error: null, contact };
}

/**
 * Reads the value of a named custom field from a GHL contact. GHL's v2
 * `/contacts/{id}` endpoint returns customFields keyed by `id` only —
 * no fieldKey — so the id-lookup path has to work. idMap is the
 * inverted catalog ({ "business_playbook": "<ghl id>", ... }) built by
 * the caller from fetchGHLCustomFieldsCatalog + buildFieldKeyToIdMap.
 *
 * The fieldKey fallback is kept for tests that stub a contact with
 * fieldKey on each customField entry, and for the rare case where
 * GHL does echo a fieldKey back (bulk search endpoints sometimes do).
 *
 * (Codex P1 on #93) Before this change the helper took `env` and
 * looked at `env.REPORT_FIELD_IDS`, which is never populated — the
 * repo's only field-id map is `CONFIG.REPORT_FIELD_IDS` in
 * `worker/src/index.js`. In production that meant every BGA case
 * read landed on the id branch with an empty idMap, fell through to
 * the fieldKey branch (which GHL doesn't send on contact fetch),
 * and returned "". The upsert path then silently overwrote the
 * verified-financials array with just the newly saved metric.
 */
export function readCustomField(contact, fieldKey, idMap = {}) {
  const cfs = Array.isArray(contact.customFields) ? contact.customFields : [];
  const id = idMap && idMap[fieldKey];
  const found = cfs.find((f) =>
    (id && f.id === id) ||
    (f.fieldKey || f.key || "") === `contact.${fieldKey}` ||
    (f.fieldKey || f.key || "") === fieldKey
  );
  const v = found?.value ?? found?.field_value ?? "";
  return typeof v === "string" ? v : String(v || "");
}

/**
 * Fetches the GHL custom-field catalog and returns a `fieldKey → id`
 * lookup. Handlers call this once per request before any readCustomField
 * so every call that follows resolves ids correctly.
 *
 * On GHLCatalogUnavailableError (network / non-ok), returns {} so the
 * handler can still try the fieldKey-fallback path rather than failing
 * the whole request. The caller gets a loud "field missing" symptom
 * instead of a 503 cascade; a 503 on catalog alone would make the whole
 * case view unusable, which is a worse failure mode for the strategist.
 */
export async function resolveFieldIdMap(env) {
  try {
    const catalog = await fetchGHLCustomFieldsCatalog(env);
    return buildFieldKeyToIdMap(catalog);
  } catch (e) {
    console.warn(`[bga_copilot] resolveFieldIdMap: ${e?.message || e}`);
    return {};
  }
}

// (PR 10 / §8) The direct GHL custom-field write path is now owned
// by worker/src/bga_copilot/version_history.js. See writeFieldsAndAppendHistory.

/**
 * Expected request body shape for /asksolomon/case/audit-gaps:
 *   { contactId: "<ghl contact id>" }
 *
 * Response shape:
 *   {
 *     success: true,
 *     contactId,
 *     intake_present: boolean,          // business_playbook (Part 1) present
 *     strategist_brief_present: boolean,
 *     full_diagnostic_present: boolean, // swot_full_report present
 *     verified_financials: {
 *       present_metric_ids: [...],      // from CANONICAL_METRIC_IDS
 *       missing_metric_ids: [...],
 *       entries_count: number
 *     },
 *     canonical_metrics: {              // echo so the console can render labels
 *       <metric_id>: { label, shape, unit },
 *       ...
 *     }
 *   }
 */
export async function handleAuditCaseGaps(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }
  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  if (!contactId) return json({ success: false, error: "contactId required" }, 400);

  const { contact, error } = await fetchGhlContact(contactId, env);
  if (!contact) return json({ success: false, error: error || "contact fetch failed" }, 503);

  // Codex P1 on #93: resolve bare {id,value} customFields via the GHL
  // field catalog (one cached /customFields fetch per worker instance).
  const idMap = await resolveFieldIdMap(env);
  const playbook = readCustomField(contact, "business_playbook", idMap);
  const brief = readCustomField(contact, "swot_strategist_brief", idMap);
  const fullDiag = readCustomField(contact, "swot_full_report", idMap);
  const vfRaw = readCustomField(contact, VERIFIED_FINANCIALS_FIELD_KEY, idMap);
  const vfEntries = parseVerifiedFinancials(vfRaw);
  // Codex P1 on #93 (concurrency, now in PR 5a): expose entries_hash
  // on every read so the client can pin its next write to a known
  // current state.
  const entriesHash = await hashVerifiedFinancialsRaw(vfRaw);

  const presentIds = vfEntries
    .map((e) => (e && e.metric_id ? e.metric_id : null))
    .filter((id) => id && isCanonicalMetric(id));
  const missingIds = missingMetricIds(vfEntries);

  // Echo the canonical metrics so the console can render labels without
  // duplicating the vocabulary in client code.
  const canonicalMetrics = {};
  for (const id of CANONICAL_METRIC_IDS) {
    const spec = CANONICAL_METRICS[id];
    canonicalMetrics[id] = { label: spec.label, shape: spec.shape, unit: spec.unit };
  }

  return json({
    success: true,
    contactId,
    intake_present: playbook.trim().length > 0,
    strategist_brief_present: brief.trim().length > 0,
    full_diagnostic_present: fullDiag.trim().length > 0,
    verified_financials: {
      present_metric_ids: presentIds,
      missing_metric_ids: missingIds,
      entries_count: vfEntries.length,
      entries_hash: entriesHash,
    },
    canonical_metrics: canonicalMetrics,
  });
}

/**
 * Expected request body shape for /asksolomon/case/verified-financials:
 *   {
 *     contactId: "<id>",
 *     entry: { metric_id, value, period, source_doc, note (optional) },
 *     expected_entries_hash: "<sha256 hex, from the last /audit-gaps or /case/load>"
 *   }
 *
 * Validates against the canonical metric vocabulary + per-shape value
 * rules. Upserts the entry (by metric_id) into the swot_verified_financials
 * JSON array. Writes the updated array back to GHL as a JSON string.
 *
 * provenance is forced to "verified" — this tool only writes verified
 * entries. recorded_at is server-stamped so the audit trail reflects the
 * write time, not the strategist's clock.
 *
 * Concurrency (Codex P1 on #93, now PR 5a):
 *   `expected_entries_hash` is required. The server computes the hash of
 *   the current stored string and compares. On mismatch, 409 with
 *   `current_entries_hash` + current `entries` so the client can
 *   reconcile and retry. On match, the write proceeds; the response
 *   carries the NEW `entries_hash` so the client can pin the next
 *   write without re-fetching.
 *
 * Returns the updated full array so the console can refresh its table
 * without a round-trip to re-read GHL.
 */
export async function handleVerifiedFinancialsPanel(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  if (!contactId) return json({ success: false, error: "contactId required" }, 400);

  const incoming = body.entry;
  if (!incoming || typeof incoming !== "object") {
    return json({ success: false, error: "entry required" }, 400);
  }

  const expectedHash = typeof body.expected_entries_hash === "string"
    ? body.expected_entries_hash.trim().toLowerCase()
    : "";
  if (!expectedHash) {
    return json({
      success: false,
      error: "expected_entries_hash required (read it from /case/load or /case/audit-gaps)",
    }, 400);
  }

  // Build the entry we'll store. Force provenance; stamp recorded_at.
  const entry = {
    metric_id: incoming.metric_id,
    value: incoming.value,
    period: incoming.period,
    source_doc: incoming.source_doc,
    note: incoming.note,
    provenance: "verified",
    recorded_at: new Date().toISOString(),
  };
  const check = validateVerifiedFinancialEntry(entry);
  if (!check.ok) return json({ success: false, error: check.error }, 400);

  // Read current entries, upsert, write back.
  const { contact, error } = await fetchGhlContact(contactId, env);
  if (!contact) return json({ success: false, error: error || "contact fetch failed" }, 503);

  // Codex P1 on #93: id-based resolution — see resolveFieldIdMap docstring.
  const idMap = await resolveFieldIdMap(env);
  const currentRaw = readCustomField(contact, VERIFIED_FINANCIALS_FIELD_KEY, idMap);

  // Optimistic concurrency guard. The hash is computed against the raw
  // stored string the Worker last wrote; any byte-level difference
  // (another save in flight, a strategist editing in HL directly)
  // trips a mismatch and the client refetches.
  const currentHash = await hashVerifiedFinancialsRaw(currentRaw);
  if (currentHash !== expectedHash) {
    const current = parseVerifiedFinancials(currentRaw);
    return json({
      success: false,
      error: "entries_hash mismatch — refetch and retry",
      conflict: true,
      current_entries_hash: currentHash,
      entries: current,
    }, 409);
  }

  const current = parseVerifiedFinancials(currentRaw);
  const next = upsertEntry(current, entry);
  const nextRaw = JSON.stringify(next);

  // Route through the shared version-history wrapper (§8 / PR 10):
  // one audit entry for the verified-financials write, PUT atomic with
  // history. Note: the optimistic-concurrency hash check above (409 on
  // mismatch) still fires BEFORE the wrapper call; the wrapper only
  // handles the write path, not the concurrency precondition.
  const historyRaw = readCustomField(contact, HISTORY_FIELD_KEY, idMap);
  const wrote = await writeFieldsAndAppendHistory({
    contactId,
    fieldWrites: [{ key: VERIFIED_FINANCIALS_FIELD_KEY, value: nextRaw }],
    action: "verified_financials_panel",
    affectedFields: [VERIFIED_FINANCIALS_FIELD_KEY],
    historyRaw,
    env,
  });
  if (!wrote.success) {
    return json({ success: false, error: wrote.error }, wrote.status || 503);
  }

  const nextHash = await hashVerifiedFinancialsRaw(nextRaw);

  return json({
    success: true,
    contactId,
    entries: next,
    entries_hash: nextHash,
    added_or_updated: entry.metric_id,
  });
}

// Re-export the metrics module's public surface so external callers (tests,
// the index.js registrar) can get everything from one entry point.
export {
  CANONICAL_METRICS,
  CANONICAL_METRIC_IDS,
  isCanonicalMetric,
  validateVerifiedFinancialEntry,
  missingMetricIds,
  parseVerifiedFinancials,
  upsertEntry,
};
