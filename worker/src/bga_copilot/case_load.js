// BGA Copilot — case load endpoint.
//
// PR 4 of the build (docs/BGA_COPILOT_SPEC.md §11 row 4): assembles the
// case bundle at load time from GHL state. Everything in the bundle is
// internal (strategist-facing); nothing here is customer-visible.
//
// Spec reference: §2.1 "Loading a case" — the bundle shape this
// endpoint produces IS the system context the console shows to the
// strategist when they pick a swot_paid_297 contact.
//
// Read-only. This endpoint never issues a PUT to GHL. Writes are the
// job of the individual toolkit handlers (verified_financials_panel,
// generate_roadmap_draft, …).

import {
  fetchGhlContact,
  readCustomField,
  json,
} from "./case_handlers.js";
import {
  parseVerifiedFinancials,
  isCanonicalMetric,
  missingMetricIds,
  CANONICAL_METRICS,
  CANONICAL_METRIC_IDS,
} from "./metrics.js";
import {
  fetchGHLCustomFieldsCatalog,
  buildFieldKeyToIdMap,
} from "../ghl_catalog.js";
import { hashVerifiedFinancialsRaw } from "./vf_hash.js";

const PAID_297_TAG = "swot_paid_297";
const REHAB_TAG = "swot_rehab";

/**
 * Fields the strategist already sees as their own panels (generated
 * artifacts / internal state). Exclude from the raw intake-answers
 * list so the strategist's view isn't duplicated.
 *
 * Note: fields with `swot_` prefix are already filtered by the
 * Solomon-owned-by-name rule below — these are the exceptions that
 * don't carry the prefix.
 */
const INTAKE_ANSWER_EXCLUDE_KEYS = new Set([
  "business_playbook",
]);

/**
 * Field keys the bundle reads from the contact. Grouped by purpose so
 * a reader can see what the view will show without scrolling through
 * the response assembler.
 */
const BUNDLE_FIELDS = {
  intake: {
    business_playbook: "business_playbook",
    strategist_brief: "swot_strategist_brief",
    full_diagnostic: "swot_full_report",
  },
  case_state: {
    verified_financials: "swot_verified_financials",
    financials_request_list: "swot_financials_request_list",
    growth_plan_draft: "swot_growth_plan_draft",
    decisions: "swot_bga_decisions",
    services_selected: "swot_bga_services_selected",
    prep_brief: "swot_bga_prep_brief",
    red_team_report: "swot_bga_red_team_report",
  },
};

/**
 * Classification per spec §2.1. The exact rule set is going to be
 * refined by Miguel as cases come in; for now:
 *   - rehab_flag true          → "rehab"
 *   - any opportunity flag set → "needs-attention"
 *   - otherwise                → "growth"
 *
 * Opportunity flags are HL tags ending in "_opp" (e.g. "ar_aging_opp").
 */
function classify(tags, rehabFlag) {
  if (rehabFlag) return "rehab";
  if (tags.some((t) => typeof t === "string" && t.endsWith("_opp"))) {
    return "needs-attention";
  }
  return "growth";
}

/**
 * Returns the number of whole days between `then` and `now`, or null
 * if `then` is not a valid date. Clamped to >= 0 (negative "days
 * since" would be a GHL time-skew artifact, not a real value).
 */
function daysSince(then, now = new Date()) {
  if (!then) return null;
  const t = new Date(then);
  if (Number.isNaN(t.getTime())) return null;
  const ms = now.getTime() - t.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Pulls the business name from the contact. GHL contacts don't have a
 * single canonical "business name" field — strategists use whichever
 * of companyName / firstName / name holds the real value. Returns the
 * first non-empty one, else empty string.
 */
function businessName(contact) {
  const candidates = [
    contact.companyName,
    contact.businessName,
    contact.firstName,
    contact.fullNameLowerCase,
    contact.name,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

/**
 * Extracts the paid_297 survey narrative fields from a hydrated
 * contact. Spec §2.1 requires every paid_297 narrative field,
 * labeled, in the loaded bundle — these are the client's own-words
 * answers that Solomon turned into business_playbook. The strategist
 * needs them during a case to answer "what did the client actually
 * say about X?" without digging through the HL contact.
 *
 * Filter rules (mirrors `answersFromContactFields` in index.js):
 *   - value must be non-empty
 *   - exclude keys / names with `swot_` prefix (all Solomon-owned
 *     fields, including the entire BGA toolkit's output)
 *   - exclude a short allowlist of generated artifacts already shown
 *     as their own panels (business_playbook)
 *   - exclude file uploads (value is a URL to a file; not analyzable
 *     and not what the strategist needs here)
 *
 * Returns `[{ fieldKey, label, value }]` — label is the catalog name
 * (friendliest) or the fieldKey (fallback). Fields without any
 * resolvable label are dropped rather than shown as "field <id>".
 *
 * `catalog` is the raw {id → meta} catalog, not the inverted idMap;
 * handlers pass both because the hydration here needs the full meta
 * per id, not just a reverse index.
 */
export function extractPaid297IntakeAnswers(contact, catalog) {
  const cfs = Array.isArray(contact.customFields) ? contact.customFields : [];
  const results = [];
  for (const f of cfs) {
    if (!f || !f.id) continue;
    const raw = f.value ?? f.field_value;
    const value = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
    if (!value || !value.trim()) continue;

    const meta = (catalog && catalog[f.id]) || {};
    const fieldKey = f.fieldKey || f.key || meta.fieldKey || "";
    const name = f.name || meta.name || "";
    const bareKey = fieldKey.startsWith("contact.")
      ? fieldKey.slice("contact.".length)
      : fieldKey;

    const lowerKey = bareKey.toLowerCase();
    const lowerName = String(name).toLowerCase();
    if (lowerKey.startsWith("swot_") || lowerName.startsWith("swot ")) continue;
    if (INTAKE_ANSWER_EXCLUDE_KEYS.has(bareKey)) continue;

    if (looksLikeFileUpload(value, bareKey, name)) continue;

    const label = name || bareKey;
    if (!label) continue;

    results.push({
      fieldKey: bareKey,
      label,
      value: value.trim(),
    });
  }
  return results;
}

function looksLikeFileUpload(value, key, name) {
  if (!/^https?:\/\//i.test(value)) return false;
  const k = String(key || "").toLowerCase();
  const n = String(name || "").toLowerCase();
  return k.includes("file_upload") || k.includes("upload") ||
         n.includes("file upload") || n.includes("upload") ||
         /\.(pdf|xlsx?|csv|docx?|png|jpe?g)(\?|$)/i.test(value);
}

/**
 * Assembles the bundle. Pure once contact + idMap + catalog are known;
 * split out so the test suite can exercise the shape without stubbing GHL.
 *
 * `idMap` is the inverted catalog from `resolveFieldIdMap(env)` — e.g.
 * `{ "business_playbook": "<ghl id>", … }`. `catalog` is the raw
 * `{id → meta}` map (optional; `{}` is fine when no catalog is
 * available). Required because GHL's `/contacts/{id}` returns
 * customFields keyed by id only (Codex P1 on #93).
 */
export function assembleCaseBundle(contact, idMap, { contactId, catalog } = { contactId: undefined, catalog: {} }) {
  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  const rehabFlag =
    tags.includes(REHAB_TAG) ||
    readCustomField(contact, "swot_rehab_flag", idMap).trim() === "true";
  const classification = classify(tags, rehabFlag);
  const opportunityFlags = tags.filter(
    (t) => typeof t === "string" && t.endsWith("_opp"),
  );

  // Intake / long-form content fields. Empty string if the field isn't
  // on the contact yet. The console renders "not present" from the
  // empty string; it does not need a separate flag.
  const businessPlaybook = readCustomField(
    contact, BUNDLE_FIELDS.intake.business_playbook, idMap,
  );
  const strategistBrief = readCustomField(
    contact, BUNDLE_FIELDS.intake.strategist_brief, idMap,
  );
  const fullDiagnostic = readCustomField(
    contact, BUNDLE_FIELDS.intake.full_diagnostic, idMap,
  );

  // Verified financials: parse the LARGE_TEXT JSON, filter to canonical
  // entries, compute what's missing. The audit endpoint computes the
  // same thing; the case view shows both without a second round-trip.
  const vfRaw = readCustomField(
    contact, BUNDLE_FIELDS.case_state.verified_financials, idMap,
  );
  const vfEntries = parseVerifiedFinancials(vfRaw);
  const presentMetricIds = vfEntries
    .map((e) => (e && e.metric_id ? e.metric_id : null))
    .filter((id) => id && isCanonicalMetric(id));
  const missingIds = missingMetricIds(vfEntries);

  // Case state flags — presence booleans, no content leak. The console
  // uses these to decide which toolkit buttons to show as "ready".
  const financialsRequestList = readCustomField(
    contact, BUNDLE_FIELDS.case_state.financials_request_list, idMap,
  );
  const growthPlanDraft = readCustomField(
    contact, BUNDLE_FIELDS.case_state.growth_plan_draft, idMap,
  );
  const decisionsRaw = readCustomField(
    contact, BUNDLE_FIELDS.case_state.decisions, idMap,
  );
  const servicesSelectedRaw = readCustomField(
    contact, BUNDLE_FIELDS.case_state.services_selected, idMap,
  );
  const prepBrief = readCustomField(
    contact, BUNDLE_FIELDS.case_state.prep_brief, idMap,
  );
  const redTeamReport = readCustomField(
    contact, BUNDLE_FIELDS.case_state.red_team_report, idMap,
  );

  // Decisions / services may be JSON arrays or free text; we only need
  // counts here. parse_* is deliberately lenient — empty / malformed
  // → 0, never throws.
  const decisionsCount = countJsonArrayItems(decisionsRaw);
  const servicesSelected = parseServicesList(servicesSelectedRaw);

  // Day-since computation. GHL writes a timestamp alongside tag
  // application in `tags` metadata, but the v2 contact GET endpoint
  // doesn't surface it as a separate structured field. For now, read
  // from a dedicated date-stamp field; return null if the contact
  // doesn't have one yet (the console renders "—").
  //
  // (Codex P2 on #94) Previously fell back to `contact.dateAdded`,
  // which predates the paid_297 purchase for any existing lead who
  // upgrades. That mislabeled days-old purchases as months-overdue
  // and defeated the "sort by day-since-purchase" prioritization
  // §2.1 calls for. Prefer "null" over a wrong number; the HL
  // workflow that applies swot_paid_297 writes
  // swot_paid_297_applied_at at the same time (follow-up HL task;
  // once wired, this read fills in automatically).
  const dayStamp = readCustomField(contact, "swot_paid_297_applied_at", idMap) || null;
  const daysSincePaid297 = daysSince(dayStamp);

  return {
    contactId,
    business_name: businessName(contact),
    status: {
      day_since_paid_297: daysSincePaid297,
      target_days_for_first_draft: 5,
    },
    classification,
    rehab_flag: rehabFlag,
    opportunity_flags: opportunityFlags,
    tags,

    intake: {
      business_playbook: businessPlaybook,
      strategist_brief: strategistBrief,
      full_diagnostic: fullDiagnostic,
      // (Codex P1 on #94) Spec §2.1 requires every paid_297 narrative
      // field in the loaded bundle. Hydrated and filtered here so the
      // strategist can see the client's own words during the case.
      paid_297_answers: extractPaid297IntakeAnswers(contact, catalog || {}),
    },

    verified_financials: {
      entries: vfEntries,
      present_metric_ids: presentMetricIds,
      missing_metric_ids: missingIds,
      entries_count: vfEntries.length,
    },

    case_state: {
      financial_request_list_drafted: financialsRequestList.trim().length > 0,
      growth_plan_draft_present: growthPlanDraft.trim().length > 0,
      prep_brief_present: prepBrief.trim().length > 0,
      red_team_report_present: redTeamReport.trim().length > 0,
      decisions_count: decisionsCount,
      services_selected: servicesSelected,
    },

    // (PR 5b) Full draft content + parsed sections so the case view
    // can render the per-section edit UI without a second round-trip.
    // Only the body of each section is returned here; the banner /
    // prefix is preserved on the server by `replaceSectionBody`.
    roadmap_draft: {
      present: growthPlanDraft.trim().length > 0,
      content: growthPlanDraft,
    },

    // (PR 7) Prep brief content for the case view's prep-brief panel.
    prep_brief: {
      present: prepBrief.trim().length > 0,
      content: prepBrief,
    },

    canonical_metrics: canonicalMetricsEcho(),
  };
}

function countJsonArrayItems(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return 0;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function parseServicesList(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((s) => (typeof s === "string" ? s : s && s.id ? s.id : null))
      .filter((s) => typeof s === "string" && s.length > 0);
  } catch {
    return [];
  }
}

function canonicalMetricsEcho() {
  const out = {};
  for (const id of CANONICAL_METRIC_IDS) {
    const spec = CANONICAL_METRICS[id];
    out[id] = { label: spec.label, shape: spec.shape, unit: spec.unit };
  }
  return out;
}

/**
 * Expected request body for POST /asksolomon/case/load:
 *   { contactId: "<ghl contact id>" }
 *
 * Response: { success: true, ...bundle } on happy path.
 *
 * Refusals:
 *   401 — console password missing / wrong
 *   400 — invalid JSON, missing contactId, or contact lacks swot_paid_297
 *   503 — GHL unreachable, contact not found, GHL non-ok, non-JSON
 */
export async function handleCaseLoad(request, env, { checkPassword }) {
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

  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  if (!tags.includes(PAID_297_TAG)) {
    return json({
      success: false,
      error: `contact is not tagged ${PAID_297_TAG}`,
    }, 400);
  }

  // Resolve bare {id,value} customFields via the catalog (one cached
  // /customFields fetch per worker instance).
  //   - Codex P1 on #93: idMap resolves id → fieldKey for reads.
  //   - Codex P1 on #94: the raw catalog is also needed for intake-
  //     answers extraction (name labels, filter-by-fieldKey rules).
  // Both derive from the single cached catalog fetch.
  let catalog = {};
  try { catalog = await fetchGHLCustomFieldsCatalog(env); }
  catch (e) { console.warn(`[case_load] catalog fetch: ${e?.message || e}`); }
  const idMap = buildFieldKeyToIdMap(catalog);
  const bundle = assembleCaseBundle(contact, idMap, { contactId, catalog });

  // Codex P1 on #93 (concurrency, now PR 5a): expose entries_hash so
  // the client can pin its next verified-financials write to the state
  // it just loaded.
  const vfRaw = readCustomField(contact, "swot_verified_financials", idMap);
  bundle.verified_financials.entries_hash = await hashVerifiedFinancialsRaw(vfRaw);

  return json({ success: true, ...bundle });
}
