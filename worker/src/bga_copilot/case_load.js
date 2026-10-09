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

const PAID_297_TAG = "swot_paid_297";
const REHAB_TAG = "swot_rehab";

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
 * Assembles the bundle. Pure once contact + env are known; split out
 * so the test suite can exercise the shape without stubbing GHL.
 */
export function assembleCaseBundle(contact, env, { contactId }) {
  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  const rehabFlag =
    tags.includes(REHAB_TAG) ||
    readCustomField(contact, "swot_rehab_flag", env).trim() === "true";
  const classification = classify(tags, rehabFlag);
  const opportunityFlags = tags.filter(
    (t) => typeof t === "string" && t.endsWith("_opp"),
  );

  // Intake / long-form content fields. Empty string if the field isn't
  // on the contact yet. The console renders "not present" from the
  // empty string; it does not need a separate flag.
  const businessPlaybook = readCustomField(
    contact, BUNDLE_FIELDS.intake.business_playbook, env,
  );
  const strategistBrief = readCustomField(
    contact, BUNDLE_FIELDS.intake.strategist_brief, env,
  );
  const fullDiagnostic = readCustomField(
    contact, BUNDLE_FIELDS.intake.full_diagnostic, env,
  );

  // Verified financials: parse the LARGE_TEXT JSON, filter to canonical
  // entries, compute what's missing. The audit endpoint computes the
  // same thing; the case view shows both without a second round-trip.
  const vfRaw = readCustomField(
    contact, BUNDLE_FIELDS.case_state.verified_financials, env,
  );
  const vfEntries = parseVerifiedFinancials(vfRaw);
  const presentMetricIds = vfEntries
    .map((e) => (e && e.metric_id ? e.metric_id : null))
    .filter((id) => id && isCanonicalMetric(id));
  const missingIds = missingMetricIds(vfEntries);

  // Case state flags — presence booleans, no content leak. The console
  // uses these to decide which toolkit buttons to show as "ready".
  const financialsRequestList = readCustomField(
    contact, BUNDLE_FIELDS.case_state.financials_request_list, env,
  );
  const growthPlanDraft = readCustomField(
    contact, BUNDLE_FIELDS.case_state.growth_plan_draft, env,
  );
  const decisionsRaw = readCustomField(
    contact, BUNDLE_FIELDS.case_state.decisions, env,
  );
  const servicesSelectedRaw = readCustomField(
    contact, BUNDLE_FIELDS.case_state.services_selected, env,
  );
  const prepBrief = readCustomField(
    contact, BUNDLE_FIELDS.case_state.prep_brief, env,
  );
  const redTeamReport = readCustomField(
    contact, BUNDLE_FIELDS.case_state.red_team_report, env,
  );

  // Decisions / services may be JSON arrays or free text; we only need
  // counts here. parse_* is deliberately lenient — empty / malformed
  // → 0, never throws.
  const decisionsCount = countJsonArrayItems(decisionsRaw);
  const servicesSelected = parseServicesList(servicesSelectedRaw);

  // Day-since computation. GHL writes a timestamp alongside tag
  // application in `tags` metadata, but the v2 contact GET endpoint
  // doesn't surface it as a separate structured field. For now:
  //   - prefer a date-stamp field if the contact has it (dateAdded
  //     fallback until the HL side writes a dedicated date on
  //     swot_paid_297 application)
  //   - fallback: null, and the console shows "—"
  const dayStamp =
    readCustomField(contact, "swot_paid_297_applied_at", env) ||
    contact.dateAdded ||
    null;
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

  const bundle = assembleCaseBundle(contact, env, { contactId });
  return json({ success: true, ...bundle });
}
