// BGA Copilot — red_team_check (PR 12; spec §4.8 + §5.3).
//
// Runs the Pre-Send QA checklist against the current draft + decisions
// + selections + verified financials + intake + services catalog and
// writes the result to `swot_bga_red_team_report`. The APPROVE & SEND
// button's endpoint re-verifies this report at request time with two
// checks:
//   1. 0 blockers in the latest report
//   2. every input hash in `inputs_checked` still matches the current
//      content for that input
//
// A mismatch on either check refuses the send with 409 "red-team report
// is stale; re-run RUN PRE-SEND QA before sending" naming the input
// that changed.
//
// Rules (§5.3):
//
//   BLOCKERS (6)
//   1. service_elevation_without_decision   — service marked "selected"
//      in services_selected whose only backing in the current draft is
//      a catalog "recommended" ranking (no explicit SM tag + no
//      strategist decision log entry calling it out).
//   2. missing_provenance_financial         — a customer-visible
//      financial claim (number + unit, like "$12K cash" or "38%
//      margin") that has no neighboring VERIFIED FACT or CLIENT-STATED
//      tag.
//   3. missing_provenance_service_match     — a service recommendation
//      in customer-visible copy that has no neighboring SERVICE MATCH /
//      [SM:] tag.
//   4. missing_90_day_section               — Section 4 ("90-Day
//      Commitments") empty / absent.
//   5. internal_terminology_in_customer_copy — one of the banned terms
//      from docs/brand/PRODUCT_NAMING_AND_LADDER.md appears in
//      customer-visible copy.
//   6. miguel_personal_pronoun               — "I will…" / "my team
//      will…" appears in customer-visible copy.
//
//   WARNINGS (4)
//   1. twelve_month_as_certainty             — a Section-6 item framed
//      as a certainty, not a reassessment/goal.
//   2. six_month_underdeveloped              — Section 5 noticeably
//      shorter than Section 4 (character-count heuristic).
//   3. intake_vs_verified_mismatch           — an intake narrative
//      value and a verified metric disagree (margin, revenue) and the
//      draft does not acknowledge the gap.
//   4. service_disqualified_still_recommended — a service recommended
//      in Section 7 that has a currently-active
//      `when_not_to_recommend` condition in the catalog.
//
// The strategist can acknowledge warnings via a separate UI toggle;
// acknowledgment appends to `acknowledged_warnings` on the report.
// Acknowledging a warning does NOT re-check the inputs — a content
// edit after acknowledgment still invalidates the report.

import {
  fetchGhlContact,
  readCustomField,
  json,
} from "./case_handlers.js";
import {
  fetchGHLCustomFieldsCatalog,
  buildFieldKeyToIdMap,
} from "../ghl_catalog.js";
import { parseDraftSections, DRAFT_BANNER } from "./roadmap.js";
import { parseVerifiedFinancials } from "./metrics.js";
import { getServicesCatalogVersion, _effectiveCatalog, primeServicesCatalog } from "./services_catalog.js";
import { assembleCaseBundle } from "./case_load.js";
import { sha256Hex } from "./vf_hash.js";
import {
  HISTORY_FIELD_KEY,
  writeFieldsAndAppendHistory,
} from "./version_history.js";

const RED_TEAM_FIELD_KEY = "swot_bga_red_team_report";
const DRAFT_FIELD_KEY = "swot_growth_plan_draft";
const DECISIONS_FIELD_KEY = "swot_bga_decisions";
const SERVICES_SELECTED_FIELD_KEY = "swot_bga_services_selected";
const VF_FIELD_KEY = "swot_verified_financials";
const PAID_297_TAG = "swot_paid_297";

export {
  RED_TEAM_FIELD_KEY,
  DRAFT_FIELD_KEY,
  DECISIONS_FIELD_KEY,
  SERVICES_SELECTED_FIELD_KEY,
  VF_FIELD_KEY,
};

// Banned internal terms — these must not appear in customer-visible
// copy. Case-insensitive match. Terms chosen per spec §5.3 blocker 5.
export const BANNED_INTERNAL_TERMS = Object.freeze([
  "SWOT",
  "rubric",
  "paid_297",
  "Deep Dive",
  "business_playbook",
  "Business Health Analysis",
  "deep-dive analysis",
  // internal path labels (checked word-boundary case-insensitive)
  "rehab",
  "urgent",
  "strong",
]);

// Miguel/strategist personal-pronoun patterns in customer-visible copy.
// Section 8 (Open Questions / Decisions) is tolerated — it's internal
// prep, and the banner above the draft marks the whole thing as DRAFT.
// For red-team: we strip the DRAFT banner before scanning, which models
// the final customer-facing view.
const PERSONAL_PRONOUN_PATTERNS = [
  /\bi\s+will\b/i,
  /\bi'll\b/i,
  /\bmy\s+team\s+will\b/i,
];

/**
 * Strip the DRAFT · INTERNAL banner so we scan what the customer will
 * actually see.
 */
function stripDraftBanner(draft) {
  if (!draft || typeof draft !== "string") return "";
  if (draft.startsWith(DRAFT_BANNER)) {
    return draft.slice(DRAFT_BANNER.length).replace(/^\s*\n+/, "");
  }
  return draft;
}

/**
 * Which sections are considered "customer-visible" when a rule talks
 * about customer-visible copy. Sections 1-7 become the final roadmap;
 * Section 8 is "Open Questions / Decisions" which stays internal to
 * the strategist prep. (The approve-and-send renderer strips §8 from
 * the public roadmap, so banned terms in §8 are not red-team blockers.)
 */
const CUSTOMER_VISIBLE_SECTION_NUMBERS = [1, 2, 3, 4, 5, 6, 7];

function joinCustomerVisible(parsed) {
  const parts = [];
  for (const s of parsed.sections) {
    if (CUSTOMER_VISIBLE_SECTION_NUMBERS.includes(s.n)) {
      parts.push(`## Section ${s.n} — ${s.title}\n${s.body || ""}`);
    }
  }
  return parts.join("\n\n");
}

// -------- Blocker 1: service elevation without a decision -----------

function findSelectedServiceIdsFromSelections(selectionsRaw) {
  if (!selectionsRaw || typeof selectionsRaw !== "string") return [];
  let parsed;
  try { parsed = JSON.parse(selectionsRaw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const e of parsed) {
    if (e && typeof e === "object" && typeof e.service_id === "string" && e.status === "selected") {
      out.push(e.service_id);
    } else if (typeof e === "string") {
      // Legacy flat-string shape — treat as selected.
      out.push(e);
    }
  }
  return out;
}

function findSMTagServiceIdsInDraft(draft) {
  // Match [SM: fractional_cfo_core, signal=low_margin_visibility]
  const re = /\[SM:\s*([a-z0-9_]+)/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(draft)) !== null) out.add(m[1].toLowerCase());
  return out;
}

function findDecisionServiceIds(decisionsRaw) {
  if (!decisionsRaw || typeof decisionsRaw !== "string") return new Set();
  let parsed;
  try { parsed = JSON.parse(decisionsRaw); } catch { return new Set(); }
  if (!Array.isArray(parsed)) return new Set();
  const out = new Set();
  for (const e of parsed) {
    const text = e && typeof e.text === "string" ? e.text.toLowerCase() : "";
    // Any service id (lowercase_with_underscores) mentioned in a decision entry
    const re = /\b([a-z][a-z0-9_]+)\b/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[1].length >= 3 && m[1].includes("_")) out.add(m[1]);
    }
  }
  return out;
}

export function checkServiceElevationWithoutDecision(ctx) {
  const { draft, decisions, selections } = ctx;
  const selected = findSelectedServiceIdsFromSelections(selections);
  if (selected.length === 0) return [];
  const smTagsInDraft = findSMTagServiceIdsInDraft(draft || "");
  const decisionIds = findDecisionServiceIds(decisions);
  const out = [];
  for (const sid of selected) {
    const sidLower = sid.toLowerCase();
    if (!smTagsInDraft.has(sidLower) && !decisionIds.has(sidLower)) {
      out.push({
        id: "service_elevation_without_decision",
        where: `services_selected: ${sid}`,
        detail: `Service "${sid}" is marked selected but has no [SM:] tag in the draft and no mention in call decisions. A catalog match alone cannot elevate to "selected" — requires an explicit record of the strategist decision.`,
      });
    }
  }
  return out;
}

// -------- Blocker 2: financial claim with no provenance -----------

// A financial-shape token: $12k, $1,200, 38%, 15.5%, 1.2x, $12K cash etc.
// We flag these only when they appear in customer-visible copy without
// a nearby provenance tag (VERIFIED FACT or CLIENT-STATED) in the
// same line or the preceding/following line.
const FINANCIAL_SHAPE_RE =
  /(?<![a-zA-Z_])(?:\$[\d,]+(?:\.\d+)?[kKmMbB]?|\d+(?:\.\d+)?%|\d+(?:\.\d+)?x\b)/g;
const PROVENANCE_TAG_RE = /\[(?:VF|CS|VERIFIED\s+FACT|CLIENT[- ]STATED)[^\]]*\]/i;

export function checkMissingProvenanceFinancial(ctx) {
  const customer = ctx.customer_visible || "";
  if (!customer) return [];
  const lines = customer.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    FINANCIAL_SHAPE_RE.lastIndex = 0;
    const matches = line.match(FINANCIAL_SHAPE_RE);
    if (!matches || matches.length === 0) continue;
    // Window: this line + 1 above + 1 below
    const window = [lines[i - 1] || "", line, lines[i + 1] || ""].join("\n");
    if (PROVENANCE_TAG_RE.test(window)) continue;
    out.push({
      id: "missing_provenance_financial",
      where: `line ${i + 1}: "${line.slice(0, 80)}"`,
      detail: `Financial claim(s) ${matches.join(", ")} with no neighboring VERIFIED FACT or CLIENT-STATED tag.`,
    });
    if (out.length >= 20) break;
  }
  return out;
}

// -------- Blocker 3: service recommendation without SM tag -----------

export function checkMissingProvenanceServiceMatch(ctx) {
  // Section 7 is the Service Recommendations section. Each item there
  // must carry an [SM: service_id, signal=slug] tag per §3.1.
  const section7 = (ctx.parsed_sections.sections || []).find((s) => s.n === 7);
  if (!section7) return [];
  const body = section7.body || "";
  if (!body.trim()) return [];
  // Treat a bulleted list; each top-level bullet is a recommendation
  // item that must carry at least one [SM:] tag.
  const bullets = body
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => /^\s*[-*]\s+\S/.test(l));
  const out = [];
  for (const bullet of bullets) {
    if (/^[-*]\s*\[SM:/i.test(bullet.trim())) continue;
    if (/\[SM:[^\]]+\]/i.test(bullet)) continue;
    out.push({
      id: "missing_provenance_service_match",
      where: `section 7: "${bullet.trim().slice(0, 80)}"`,
      detail: "Service recommendation without a [SM: service_id, signal=slug] provenance tag.",
    });
    if (out.length >= 10) break;
  }
  return out;
}

// -------- Blocker 4: missing 90-day section -----------

export function checkMissing90DaySection(ctx) {
  const section4 = (ctx.parsed_sections.sections || []).find((s) => s.n === 4);
  if (!section4 || !(section4.body || "").trim()) {
    return [{
      id: "missing_90_day_section",
      where: "section 4",
      detail: "Section 4 (90-Day Commitments) is missing or empty.",
    }];
  }
  return [];
}

// -------- Blocker 5: banned internal terms -----------

export function checkInternalTerminology(ctx) {
  const customer = ctx.customer_visible || "";
  if (!customer) return [];
  const out = [];
  for (const term of BANNED_INTERNAL_TERMS) {
    // Build a word-boundary case-insensitive regex. Escape regex metas
    // in the term (hyphens, underscores etc.).
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Allow underscore/hyphen word members; use a conservative boundary.
    const re = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "i");
    if (re.test(customer)) {
      out.push({
        id: "internal_terminology_in_customer_copy",
        where: "customer-visible copy",
        detail: `Banned internal term "${term}" detected in customer-visible copy.`,
      });
    }
  }
  return out;
}

// -------- Blocker 6: Miguel-personal pronouns in customer copy -----

export function checkPersonalPronouns(ctx) {
  const customer = ctx.customer_visible || "";
  if (!customer) return [];
  const out = [];
  for (const re of PERSONAL_PRONOUN_PATTERNS) {
    const m = customer.match(re);
    if (m) {
      out.push({
        id: "miguel_personal_pronoun",
        where: "customer-visible copy",
        detail: `Personal pronoun "${m[0]}" in customer-visible copy. The customer-facing roadmap speaks for CFO By Design, not for one strategist by name.`,
      });
      break; // one is enough to block; strategist fixes and re-runs
    }
  }
  return out;
}

// -------- Warning 1: 12-month item framed as certainty -------------

export function checkTwelveMonthCertainty(ctx) {
  const section6 = (ctx.parsed_sections.sections || []).find((s) => s.n === 6);
  if (!section6) return [];
  const body = section6.body || "";
  if (!body.trim()) return [];
  // Certainty markers: "will reach", "we will", "we'll", "projected to hit"
  // without a reassessment-framing qualifier near it ("goal", "target",
  // "reassess", "revisit", "aim to").
  const certaintyRe = /\b(we\s+will|we'll|will\s+reach|will\s+hit|will\s+achieve|projected\s+to\s+hit)\b/i;
  const reframeRe = /\b(goal|target|aim\s+to|reassess|revisit|intend\s+to)\b/i;
  if (certaintyRe.test(body) && !reframeRe.test(body)) {
    return [{
      id: "twelve_month_as_certainty",
      where: "section 6",
      detail: "Section 6 (12-month) framed as a certainty rather than a reassessment goal.",
    }];
  }
  return [];
}

// -------- Warning 2: 6-month section shorter than 90-day -----------

export function checkSixMonthUnderdeveloped(ctx) {
  const s4 = (ctx.parsed_sections.sections || []).find((s) => s.n === 4);
  const s5 = (ctx.parsed_sections.sections || []).find((s) => s.n === 5);
  if (!s4 || !s5) return [];
  const len4 = (s4.body || "").trim().length;
  const len5 = (s5.body || "").trim().length;
  if (len4 > 200 && len5 < Math.round(len4 * 0.5)) {
    return [{
      id: "six_month_underdeveloped",
      where: "section 5",
      detail: `Section 5 (6-month) is ${len5} chars vs section 4's ${len4} chars (under 50% of 90-day) — likely under-developed.`,
    }];
  }
  return [];
}

// -------- Warning 3: intake-vs-verified mismatch -----------

/**
 * Pull a numeric value from an intake narrative string. Returns null if
 * no shape matches. Looks for percentages or dollar amounts.
 */
function numericFromText(text) {
  if (!text || typeof text !== "string") return null;
  const pctMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctMatch) return { kind: "pct", value: Number(pctMatch[1]) };
  const dollarMatch = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([kKmMbB])?/);
  if (dollarMatch) {
    const raw = Number(dollarMatch[1].replace(/,/g, ""));
    const mult = dollarMatch[2]
      ? ({ k: 1e3, m: 1e6, b: 1e9 }[dollarMatch[2].toLowerCase()] || 1)
      : 1;
    return { kind: "usd", value: raw * mult };
  }
  return null;
}

export function checkIntakeVsVerifiedMismatch(ctx) {
  const vfEntries = parseVerifiedFinancials(ctx.verified_financials);
  if (!Array.isArray(vfEntries) || vfEntries.length === 0) return [];
  const intake = Array.isArray(ctx.intake_answers) ? ctx.intake_answers : [];
  if (intake.length === 0) return [];
  const out = [];
  // Map intake q/a onto numeric candidates; compare with VF metrics.
  const vfByMetric = new Map();
  for (const e of vfEntries) {
    if (e && typeof e.metric_id === "string") vfByMetric.set(e.metric_id, e);
  }
  const customerLower = (ctx.customer_visible || "").toLowerCase();
  const draftAcksMismatch = /intake|client[-\s]stated|disagree|differs|differ|discrep/.test(customerLower);
  for (const a of intake) {
    const answer = typeof a.answer === "string" ? a.answer : "";
    const question = typeof a.question === "string" ? a.question.toLowerCase() : "";
    const num = numericFromText(answer);
    if (!num) continue;
    if (num.kind === "pct" && /margin/.test(question)) {
      const vf = vfByMetric.get("gross_margin_pct") || vfByMetric.get("net_profit_pct");
      if (vf && typeof vf.value === "number" && Math.abs(vf.value - num.value) >= 3) {
        if (!draftAcksMismatch) {
          out.push({
            id: "intake_vs_verified_mismatch",
            where: `intake vs ${vf.metric_id}`,
            detail: `Intake says ${num.value}% margin, verified ${vf.metric_id} = ${vf.value}%. Draft does not call out the gap.`,
          });
        }
      }
    }
    if (num.kind === "usd" && /revenue|ttm|annual/.test(question)) {
      const vf = vfByMetric.get("revenue_ttm");
      if (vf && typeof vf.value === "number") {
        const diff = Math.abs(vf.value - num.value);
        if (diff > 0 && diff / Math.max(vf.value, 1) >= 0.1) {
          if (!draftAcksMismatch) {
            out.push({
              id: "intake_vs_verified_mismatch",
              where: `intake vs revenue_ttm`,
              detail: `Intake says $${num.value}, verified revenue_ttm = $${vf.value}. Draft does not call out the gap.`,
            });
          }
        }
      }
    }
    if (out.length >= 3) break;
  }
  return out;
}

// -------- Warning 4: disqualified service still recommended --------

export function checkDisqualifiedServiceStillRecommended(ctx) {
  const smIds = Array.from(findSMTagServiceIdsInDraft(ctx.draft || ""));
  if (smIds.length === 0) return [];
  const catalog = _effectiveCatalog() || [];
  const byId = new Map();
  for (const e of catalog) if (e && e.service_id) byId.set(e.service_id, e);
  const activeDqs = new Set(ctx.active_disqualifiers || []);
  const out = [];
  for (const sid of smIds) {
    const entry = byId.get(sid);
    if (!entry) continue;
    const dqs = Array.isArray(entry.when_not_to_recommend) ? entry.when_not_to_recommend : [];
    for (const dq of dqs) {
      if (typeof dq === "string" && activeDqs.has(dq)) {
        out.push({
          id: "service_disqualified_still_recommended",
          where: `section 7: ${sid}`,
          detail: `Service "${sid}" is recommended despite active disqualifier "${dq}".`,
        });
        break;
      }
    }
  }
  return out;
}

// ---------- Input hashing (6 inputs; spec §5.3) ----------

/**
 * Canonicalize the paid_297 intake answers subset for hashing: sort by
 * fieldKey so semantically-identical content hashes the same. Reads
 * the `{fieldKey, label, value}` shape produced by
 * extractPaid297IntakeAnswers (worker/src/bga_copilot/case_load.js); if
 * `question`/`answer` are supplied (test fixtures), they're used too so
 * the warning-3 rule's hashing is independent of which upstream
 * assembled the answers.
 */
export function canonicalizeIntakeBundle(answers) {
  if (!Array.isArray(answers)) return "";
  const items = answers
    .map((a) => ({
      f: typeof a?.fieldKey === "string" ? a.fieldKey
         : typeof a?.field === "string" ? a.field : "",
      l: typeof a?.label === "string" ? a.label
         : typeof a?.question === "string" ? a.question : "",
      v: typeof a?.value === "string" ? a.value
         : typeof a?.answer === "string" ? a.answer : "",
    }))
    .sort((x, y) => (x.f + x.l).localeCompare(y.f + y.l));
  return JSON.stringify(items);
}

export async function computeInputHashes({
  draft,
  decisions,
  selections,
  verifiedFinancialsRaw,
  intakeAnswers,
  catalogRef,
}) {
  const [d, dec, sel, vf, intake] = await Promise.all([
    sha256Hex(String(draft || "")),
    sha256Hex(String(decisions || "")),
    sha256Hex(String(selections || "")),
    sha256Hex(String(verifiedFinancialsRaw || "")),
    sha256Hex(canonicalizeIntakeBundle(intakeAnswers)),
  ]);
  return {
    draft_hash: `sha256:${d}`,
    decisions_hash: `sha256:${dec}`,
    selections_hash: `sha256:${sel}`,
    verified_financials_hash: `sha256:${vf}`,
    intake_bundle_hash: `sha256:${intake}`,
    catalog_ref: catalogRef || "",
  };
}

// ---------- Build the report ----------

/**
 * Run every rule against the pre-built context. Returns the report
 * object WITHOUT inputs_checked (the handler attaches that at the end).
 */
export function runRedTeamRules(ctx) {
  const blockers = [
    ...checkServiceElevationWithoutDecision(ctx),
    ...checkMissingProvenanceFinancial(ctx),
    ...checkMissingProvenanceServiceMatch(ctx),
    ...checkMissing90DaySection(ctx),
    ...checkInternalTerminology(ctx),
    ...checkPersonalPronouns(ctx),
  ];
  const warnings = [
    ...checkTwelveMonthCertainty(ctx),
    ...checkSixMonthUnderdeveloped(ctx),
    ...checkIntakeVsVerifiedMismatch(ctx),
    ...checkDisqualifiedServiceStillRecommended(ctx),
  ];
  return { blockers, warnings };
}

/**
 * POST /asksolomon/case/red-team-check
 *
 * Body: { contactId }
 *
 * Reads the current draft/decisions/selections/VF/intake/catalog,
 * runs the 10 rules, and writes the report (with input hashes) to
 * swot_bga_red_team_report via the shared version-history wrapper.
 */
export async function handleRedTeamCheck(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  // Codex P1 on #138: prime the D1 catalog so the disqualifier-rule
  // check (which reads _effectiveCatalog() synchronously below) sees
  // the current D1 services, and so the SHA recorded on the case
  // reflects the active D1 version rather than the bundled fallback.
  await primeServicesCatalog(env);
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  if (!contactId) return json({ success: false, error: "contactId required" }, 400);

  const { contact, error } = await fetchGhlContact(contactId, env);
  if (!contact) return json({ success: false, error: error || "contact fetch failed" }, 503);

  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  if (!tags.includes(PAID_297_TAG)) {
    return json({ success: false, error: `contact is not tagged ${PAID_297_TAG}` }, 400);
  }

  let catalog = {};
  try { catalog = await fetchGHLCustomFieldsCatalog(env); }
  catch (e) { console.warn(`[red_team_check] catalog fetch: ${e?.message || e}`); }
  const idMap = buildFieldKeyToIdMap(catalog);

  const draft = readCustomField(contact, DRAFT_FIELD_KEY, idMap);
  if (!(draft || "").trim()) {
    return json({ success: false, error: "no draft present — run generate_roadmap_draft first" }, 400);
  }
  const decisionsRaw = readCustomField(contact, DECISIONS_FIELD_KEY, idMap);
  const selectionsRaw = readCustomField(contact, SERVICES_SELECTED_FIELD_KEY, idMap);
  const vfRaw = readCustomField(contact, VF_FIELD_KEY, idMap);

  const bundle = assembleCaseBundle(contact, idMap, { contactId, catalog });
  const intakeAnswers = bundle?.intake?.paid_297_answers || [];

  // Derive active disqualifiers from signals for warning 4.
  const { deriveCaseSignals } = await import("./signals.js");
  const { signals, disqualifiers } = deriveCaseSignals({
    tags,
    verified_financials_entries: parseVerifiedFinancials(vfRaw),
    paid_297_answers: intakeAnswers,
  });

  const parsed = parseDraftSections(draft);
  const customer_visible = joinCustomerVisible(parsed);

  const ctx = {
    draft,
    customer_visible,
    parsed_sections: parsed,
    decisions: decisionsRaw,
    selections: selectionsRaw,
    verified_financials: vfRaw,
    intake_answers: intakeAnswers,
    active_signals: signals,
    active_disqualifiers: disqualifiers,
  };
  const { blockers, warnings } = runRedTeamRules(ctx);

  const catalogRef = await getServicesCatalogVersion(env);
  const inputs_checked = await computeInputHashes({
    draft,
    decisions: decisionsRaw,
    selections: selectionsRaw,
    verifiedFinancialsRaw: vfRaw,
    intakeAnswers,
    catalogRef,
  });

  const report = {
    run_at: new Date().toISOString(),
    blockers,
    warnings,
    acknowledged_warnings: [],
    inputs_checked,
  };

  // Route through the shared version-history wrapper (§8 / PR 10).
  const historyRaw = readCustomField(contact, HISTORY_FIELD_KEY, idMap);
  const wrote = await writeFieldsAndAppendHistory({
    contactId,
    fieldWrites: [{ key: RED_TEAM_FIELD_KEY, value: JSON.stringify(report) }],
    action: "red_team_check",
    affectedFields: [RED_TEAM_FIELD_KEY],
    catalogRef,
    historyRaw,
    env,
  });
  if (!wrote.success) {
    return json({ success: false, error: wrote.error }, wrote.status || 503);
  }

  return json({
    success: true,
    contactId,
    report,
    blockers_count: blockers.length,
    warnings_count: warnings.length,
  });
}

/**
 * POST /asksolomon/case/acknowledge-warning
 *
 * Body: { contactId, warning_id }
 *
 * Appends warning_id to acknowledged_warnings on the latest red-team
 * report. Does NOT re-run the rules or re-hash the inputs — a content
 * change after acknowledgment still invalidates the report (approve
 * endpoint rejects on hash mismatch).
 */
export async function handleAcknowledgeWarning(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  const warningId = typeof body.warning_id === "string" ? body.warning_id.trim() : "";
  if (!contactId) return json({ success: false, error: "contactId required" }, 400);
  if (!warningId) return json({ success: false, error: "warning_id required" }, 400);

  const { contact, error } = await fetchGhlContact(contactId, env);
  if (!contact) return json({ success: false, error: error || "contact fetch failed" }, 503);

  let catalog = {};
  try { catalog = await fetchGHLCustomFieldsCatalog(env); }
  catch { /* ignore */ }
  const idMap = buildFieldKeyToIdMap(catalog);

  const reportRaw = readCustomField(contact, RED_TEAM_FIELD_KEY, idMap);
  if (!reportRaw || !reportRaw.trim()) {
    return json({ success: false, error: "no red-team report present — run red_team_check first" }, 400);
  }
  let report;
  try { report = JSON.parse(reportRaw); }
  catch { return json({ success: false, error: "red-team report is malformed JSON" }, 500); }

  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  const hasWarning = warnings.some((w) => w && w.id === warningId);
  if (!hasWarning) {
    return json({ success: false, error: `warning_id "${warningId}" is not in the latest report's warnings` }, 400);
  }
  const acked = Array.isArray(report.acknowledged_warnings) ? report.acknowledged_warnings : [];
  if (!acked.includes(warningId)) acked.push(warningId);
  report.acknowledged_warnings = acked;

  const historyRaw = readCustomField(contact, HISTORY_FIELD_KEY, idMap);
  const wrote = await writeFieldsAndAppendHistory({
    contactId,
    fieldWrites: [{ key: RED_TEAM_FIELD_KEY, value: JSON.stringify(report) }],
    action: "acknowledge_warning",
    affectedFields: [RED_TEAM_FIELD_KEY],
    historyRaw,
    env,
  });
  if (!wrote.success) {
    return json({ success: false, error: wrote.error }, wrote.status || 503);
  }

  return json({ success: true, contactId, acknowledged_warnings: acked });
}
