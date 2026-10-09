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

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const VERIFIED_FINANCIALS_FIELD_KEY = "swot_verified_financials";

/**
 * Minimal JSON response helper. The main Worker has its own json() but we
 * can't import that here without cycle risk; this is intentionally local.
 */
function json(body, status = 200) {
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
async function fetchGhlContact(contactId, env) {
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
 * API returns customFields keyed by id, not by fieldKey, but the Worker
 * doesn't know every field id yet (per spec BGA_COPILOT_HL_SETUP step 3).
 * This helper looks up by id first (if resolvable), then by fieldKey,
 * then by key, and returns the string value (or empty string).
 */
function readCustomField(contact, fieldKey, env) {
  const cfs = Array.isArray(contact.customFields) ? contact.customFields : [];
  const idMap = (env && env.REPORT_FIELD_IDS) || {};
  const id = idMap[fieldKey];
  const found = cfs.find((f) =>
    (id && f.id === id) ||
    (f.fieldKey || f.key || "") === `contact.${fieldKey}` ||
    (f.fieldKey || f.key || "") === fieldKey
  );
  const v = found?.value ?? found?.field_value ?? "";
  return typeof v === "string" ? v : String(v || "");
}

/**
 * Updates GHL contact custom fields. Thin wrapper around the Worker's
 * existing update pattern. Returns true on success, false on failure.
 */
async function updateGhlFields(contactId, fields, env) {
  if (!env.GHL_API_KEY) return false;
  let res;
  try {
    res = await fetch(`${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GHL_API_KEY}`,
        Version: "2021-07-28",
      },
      body: JSON.stringify({ customFields: fields }),
    });
  } catch {
    return false;
  }
  return res.ok;
}

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

  const playbook = readCustomField(contact, "business_playbook", env);
  const brief = readCustomField(contact, "swot_strategist_brief", env);
  const fullDiag = readCustomField(contact, "swot_full_report", env);
  const vfRaw = readCustomField(contact, VERIFIED_FINANCIALS_FIELD_KEY, env);
  const vfEntries = parseVerifiedFinancials(vfRaw);

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
    },
    canonical_metrics: canonicalMetrics,
  });
}

/**
 * Expected request body shape for /asksolomon/case/verified-financials:
 *   { contactId: "<id>", entry: {
 *       metric_id, value, period, source_doc, note (optional)
 *   } }
 *
 * Validates against the canonical metric vocabulary + per-shape value
 * rules. Upserts the entry (by metric_id) into the swot_verified_financials
 * JSON array. Writes the updated array back to GHL as a JSON string.
 *
 * provenance is forced to "verified" — this tool only writes verified
 * entries. recorded_at is server-stamped so the audit trail reflects the
 * write time, not the strategist's clock.
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

  const currentRaw = readCustomField(contact, VERIFIED_FINANCIALS_FIELD_KEY, env);
  const current = parseVerifiedFinancials(currentRaw);
  const next = upsertEntry(current, entry);

  const ok = await updateGhlFields(
    contactId,
    [{ key: VERIFIED_FINANCIALS_FIELD_KEY, field_value: JSON.stringify(next) }],
    env,
  );
  if (!ok) return json({ success: false, error: "writeback to GHL failed" }, 503);

  return json({
    success: true,
    contactId,
    entries: next,
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
