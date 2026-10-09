// BGA Copilot — match_services (PR 6, docs/BGA_COPILOT_SPEC.md §4.4 + §7).
//
// `match_services` iterates the services catalog, scores each entry's
// `signals_relevant` against the current case's active signals, and
// excludes any entry with a `when_not_to_recommend` disqualifier that
// currently applies.
//
// Guardrails that must hold at every return:
//   - Password-gated (checkConsolePassword).
//   - In "write" mode, writes ONLY `swot_growth_plan_draft` — Section
//     7 only, every other section preserved. Never touches
//     `swot_growth_plan`, `swot_growth_plan_ready`, or any tag.
//   - "readonly" mode never issues a PUT.
//   - Every recommendation emits an inline `[SM: service_id,
//     signal=slug]` tag per §3.1 bound to a canonical signal — never
//     a free-form string.

import {
  fetchGhlContact,
  readCustomField,
  resolveFieldIdMap,
  json,
} from "./case_handlers.js";
import {
  parseVerifiedFinancials,
} from "./metrics.js";
import {
  _effectiveCatalog,
  getServicesCatalogVersion,
} from "./services_catalog.js";
import {
  deriveCaseSignals,
  isCanonicalSignal,
  isCanonicalDisqualifier,
} from "./signals.js";
import {
  SECTIONS,
  parseDraftSections,
  replaceSectionBody,
} from "./roadmap.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const DRAFT_FIELD_KEY = "swot_growth_plan_draft";
const PAID_297_TAG = "swot_paid_297";

/**
 * Pure matcher. Takes an `activeSignals` + `activeDisqualifiers`
 * pair (both arrays of canonical slugs) and the catalog, and returns
 * ranked matches.
 *
 * Each result:
 *   {
 *     service_id, name, problem_solved, dependencies, pricing,
 *     matched_signals: [slug, ...],   // signals that fired
 *     score: integer,                 // = matched_signals.length
 *     excluded: boolean,
 *     excluded_by: [slug, ...]        // present disqualifiers (empty if included)
 *   }
 *
 * Order:
 *   - Included matches first, sorted by descending score, then
 *     service_id (stable).
 *   - Excluded matches after, so the strategist can see what WOULD
 *     have matched but was blocked.
 *
 * Catalog entries with non-canonical signal/disqualifier slugs are
 * resilient: a non-canonical slug silently fails to match (never
 * fires) rather than cascading as an error.
 */
export function matchServices({ activeSignals, activeDisqualifiers, catalog } = {}) {
  const signals = Array.isArray(activeSignals) ? activeSignals.filter(isCanonicalSignal) : [];
  const dqs = Array.isArray(activeDisqualifiers) ? activeDisqualifiers.filter(isCanonicalDisqualifier) : [];
  const signalSet = new Set(signals);
  const dqSet = new Set(dqs);

  const list = Array.isArray(catalog) ? catalog : _effectiveCatalog();

  const included = [];
  const excluded = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || typeof entry.service_id !== "string") continue;
    const svcSignals = Array.isArray(entry.signals_relevant) ? entry.signals_relevant : [];
    const matched_signals = svcSignals.filter((s) => signalSet.has(s));
    if (matched_signals.length === 0) continue;

    const svcDqs = Array.isArray(entry.when_not_to_recommend) ? entry.when_not_to_recommend : [];
    const excluded_by = svcDqs.filter((d) => dqSet.has(d));

    const result = {
      service_id: entry.service_id,
      name: entry.name || entry.service_id,
      problem_solved: entry.problem_solved || "",
      dependencies: Array.isArray(entry.dependencies) ? entry.dependencies : [],
      pricing: entry.pricing || null,
      matched_signals,
      score: matched_signals.length,
      excluded: excluded_by.length > 0,
      excluded_by,
    };
    (excluded_by.length ? excluded : included).push(result);
  }

  included.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.service_id < b.service_id ? -1 : a.service_id > b.service_id ? 1 : 0;
  });
  excluded.sort((a, b) => (a.service_id < b.service_id ? -1 : 1));

  return { included, excluded };
}

/**
 * Formats a match result as the Section 7 body markdown with inline
 * [SM: service_id, signal=slug] tags per spec §3.1. Returns a string
 * suitable for `replaceSectionBody(draft, 7, body)`.
 *
 * Includes:
 *   - A line per included match (ranked), each with a SM tag naming
 *     the first matched signal (strongest fit).
 *   - A line per excluded match naming what disqualified it (so the
 *     strategist can see what was considered — spec §5.3 warning 4
 *     references this).
 *   - When nothing matched, says so plainly instead of leaving the
 *     section empty.
 */
export function formatSection7Body(matches, { catalogVersion } = {}) {
  const parts = [];
  if (catalogVersion) {
    parts.push(`_Catalog version: \`${catalogVersion}\`_`);
    parts.push("");
  }
  if (!matches.included.length && !matches.excluded.length) {
    parts.push("No services matched the active signals on this case.");
    parts.push("");
    parts.push("Strategist action: add missing signals to the contact's tags, record the verified financials that would surface signals, or note here that no catalog entry fits and this case is a bespoke engagement.");
    return parts.join("\n");
  }

  if (matches.included.length) {
    parts.push("### Recommended services");
    parts.push("");
    for (const r of matches.included) {
      const primary = r.matched_signals[0];
      parts.push(`- **${r.name}** — ${r.problem_solved || "_(no problem_solved on catalog entry)_"} [SM: ${r.service_id}, signal=${primary}]`);
      if (r.matched_signals.length > 1) {
        parts.push(`  - Additional matched signals: ${r.matched_signals.slice(1).join(", ")}`);
      }
      if (r.dependencies.length) {
        parts.push(`  - Dependencies: ${r.dependencies.join(" · ")}`);
      }
      if (r.pricing && r.pricing.note) {
        parts.push(`  - Pricing: ${r.pricing.note}`);
      }
    }
    parts.push("");
  }

  if (matches.excluded.length) {
    parts.push("### Considered but excluded");
    parts.push("");
    for (const r of matches.excluded) {
      parts.push(`- **${r.name}** — excluded by: ${r.excluded_by.join(", ")}`);
    }
    parts.push("");
  }

  return parts.join("\n").replace(/\s+$/, "");
}

async function updateGhlCustomField(contactId, fieldKey, value, env) {
  if (!env.GHL_API_KEY) return false;
  try {
    const res = await fetch(`${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GHL_API_KEY}`,
        Version: "2021-07-28",
      },
      body: JSON.stringify({
        customFields: [{ key: fieldKey, field_value: value }],
      }),
    });
    return res.ok;
  } catch { return false; }
}

/**
 * POST /asksolomon/case/match-services
 *
 * Body: { contactId, mode?: "write" | "readonly" }
 *   - "write" (default): writes the formatted matches into Section 7
 *     of swot_growth_plan_draft. Refuses with 400 if no draft is
 *     present or Section 7 is missing.
 *   - "readonly": returns the matches without writing.
 *
 * Response (200, write mode):
 *   { success, contactId, matches, catalog_version, section_7_updated: true,
 *     draft }  // the full updated draft content
 *
 * Response (200, readonly):
 *   { success, contactId, matches, catalog_version, section_7_updated: false }
 */
export async function handleMatchServices(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  if (!contactId) return json({ success: false, error: "contactId required" }, 400);

  const modeIn = typeof body.mode === "string" ? body.mode.trim().toLowerCase() : "write";
  if (modeIn !== "write" && modeIn !== "readonly") {
    return json({ success: false, error: "mode must be 'write' or 'readonly'" }, 400);
  }
  const mode = modeIn;

  const { contact, error } = await fetchGhlContact(contactId, env);
  if (!contact) return json({ success: false, error: error || "contact fetch failed" }, 503);

  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  if (!tags.includes(PAID_297_TAG)) {
    return json({ success: false, error: `contact is not tagged ${PAID_297_TAG}` }, 400);
  }

  const idMap = await resolveFieldIdMap(env);
  const vfRaw = readCustomField(contact, "swot_verified_financials", idMap);
  const vfEntries = parseVerifiedFinancials(vfRaw);

  const { signals, disqualifiers } = deriveCaseSignals({
    tags, verified_financials_entries: vfEntries,
  });
  const matches = matchServices({
    activeSignals: signals, activeDisqualifiers: disqualifiers,
  });
  const catalogVersion = await getServicesCatalogVersion();

  if (mode === "readonly") {
    return json({
      success: true,
      contactId,
      active_signals: signals,
      active_disqualifiers: disqualifiers,
      matches,
      catalog_version: catalogVersion,
      section_7_updated: false,
    });
  }

  // write mode — splice into Section 7 of the current draft.
  const currentDraft = readCustomField(contact, DRAFT_FIELD_KEY, idMap);
  if (!currentDraft.trim()) {
    return json({
      success: false,
      error: "no draft present — run generate_roadmap_draft first",
    }, 400);
  }

  const { sections } = parseDraftSections(currentDraft);
  if (!sections.find((s) => s.n === 7)) {
    return json({
      success: false,
      error: "section 7 not found in current draft",
    }, 404);
  }

  const section7Body = formatSection7Body(matches, { catalogVersion });
  const nextDraft = replaceSectionBody(currentDraft, 7, section7Body);
  if (nextDraft === null) {
    return json({ success: false, error: "section 7 replace failed" }, 500);
  }

  const wrote = await updateGhlCustomField(contactId, DRAFT_FIELD_KEY, nextDraft, env);
  if (!wrote) return json({ success: false, error: "writeback to GHL failed" }, 503);

  return json({
    success: true,
    contactId,
    active_signals: signals,
    active_disqualifiers: disqualifiers,
    matches,
    catalog_version: catalogVersion,
    section_7_updated: true,
    draft: nextDraft,
  });
}

// Re-exports so test files can import matcher + formatter from one place.
export { SECTIONS };
