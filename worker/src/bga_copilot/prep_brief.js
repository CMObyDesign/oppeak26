// BGA Copilot — generate_prep_brief (PR 7, docs/BGA_COPILOT_SPEC.md §4.6).
//
// One-screen condensed briefing drawn from the current draft. Not a
// summary — a specific prep sheet with 9 fixed sections. The brief
// lives in `swot_bga_prep_brief` and is likely more day-to-day
// useful to Miguel than the full roadmap draft.
//
// Guardrails that must hold at every return:
//   - Password-gated.
//   - Writes ONLY `swot_bga_prep_brief`. Never touches
//     `swot_growth_plan`, `swot_growth_plan_draft`,
//     `swot_growth_plan_ready`, or any tag.
//   - The brief carries the "INTERNAL · PREP ONLY" banner so a
//     future red-team check that happens to inspect the prep brief
//     field can refuse to send without the banner intact.
//   - Every service recommendation in the brief carries an inline
//     [SM: service_id, signal=slug] provenance tag per §3.1 — the
//     prompt instructs Claude explicitly, and the matched signals
//     are passed in so there's a correct value to use.

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
  fetchGHLCustomFieldsCatalog,
  buildFieldKeyToIdMap,
} from "../ghl_catalog.js";
import {
  assembleCaseBundle,
} from "./case_load.js";
import {
  deriveCaseSignals,
} from "./signals.js";
import {
  matchServices,
} from "./match_services.js";
import {
  getServicesCatalogVersion,
} from "./services_catalog.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const DRAFT_FIELD_KEY = "swot_growth_plan_draft";
const PREP_BRIEF_FIELD_KEY = "swot_bga_prep_brief";
const PAID_297_TAG = "swot_paid_297";

export const PREP_BRIEF_BANNER =
  "📋 INTERNAL · PREP ONLY · NOT CUSTOMER-FACING 📋";

/**
 * The 9 fixed sections per spec §4.6, in order. Numbers are stable
 * for test pinning; the title is the literal heading written to
 * `swot_bga_prep_brief`.
 */
export const PREP_BRIEF_SECTIONS = Object.freeze([
  { n: 1, title: "Top 3 financial priorities (ranked, with VF provenance)" },
  { n: 2, title: "Verified facts supporting each one" },
  { n: 3, title: "Assumptions still needing validation" },
  { n: 4, title: "Questions Miguel should ask" },
  { n: 5, title: "90-day roadmap preview" },
  { n: 6, title: "Likely objections or concerns" },
  { n: 7, title: "Services worth discussing (with SM provenance)" },
  { n: 8, title: "Services NOT to recommend (with reason)" },
  { n: 9, title: "Decisions the call needs to produce" },
]);

/**
 * System prompt pinned here. Mirrors the discipline of the roadmap
 * prompt: closed provenance tag set, verbatim banner, exact 9-section
 * heading list. Section 7 and 8 call out the SM tag format.
 */
export function buildPrepBriefSystemPrompt() {
  return `You are the senior strategist's internal call-prep copilot. Produce a one-screen prep brief Miguel reads before the live BGA call. INTERNAL only — never seen by the client in this form.

Hard rules you MUST follow every time:

1. The very first line of your output is this banner, verbatim:
${PREP_BRIEF_BANNER}

2. Produce exactly 9 level-2 markdown sections, in order, with these headings and nothing else at level 2:
${PREP_BRIEF_SECTIONS.map((s) => `## Section ${s.n} — ${s.title}`).join("\n")}

3. Every material claim carries an inline provenance tag drawn from this closed set:
   - [VF: <metric_id> = <value>, period=<p>, source=<doc>]
   - [CS: <question_slug>, from <field_key>, "<short quote or paraphrase>"]
   - [SJ: <YYYY-MM-DDTHH:MM>, "<the judgment>"]
   - [SM: <service_id>, signal=<signal_slug>]

4. Section 7 ("Services worth discussing"): one line per included service match passed in SERVICES, with its SM tag binding to the primary matched signal. Use the EXACT service_id and signal slug from the matches — do not invent new ones.

5. Section 8 ("Services NOT to recommend"): one line per excluded service match passed in SERVICES, naming the disqualifier(s) that excluded it. No SM tag on this section — these aren't recommendations.

6. Each of Section 1 (priorities) and Section 2 (facts) should have at most 3 items (not more). This brief is a one-screen read; brevity matters more than completeness.

7. Do NOT use first-person claims like "I will…" or "my team will…" — the firm name is "CFO By Design", not a person. Second-person "you/your" is for prep notes about the client; keep it concise.

8. Output ONLY the brief starting with the banner. No preamble, no explanation, no post-script.
`;
}

/**
 * User prompt builder. Hands Claude the draft (full content, not
 * just section 7) + the fresh match_services output + a short case
 * frame.
 */
export function buildPrepBriefUserPrompt(bundle, { draft, matches, catalogVersion } = {}) {
  const vf = Array.isArray(bundle?.verified_financials?.entries)
    ? bundle.verified_financials.entries
    : [];
  const intake = bundle?.intake || {};
  const answers = Array.isArray(intake.paid_297_answers) ? intake.paid_297_answers : [];

  const parts = [];
  parts.push(`CASE: ${bundle?.business_name || "(no business name)"} · contactId=${bundle?.contactId}`);
  if (bundle?.classification) parts.push(`Classification: ${bundle.classification}`);
  if (bundle?.rehab_flag) parts.push("Rehab flag: true");
  if (Array.isArray(bundle?.opportunity_flags) && bundle.opportunity_flags.length) {
    parts.push(`Opportunity flags: ${bundle.opportunity_flags.join(", ")}`);
  }
  parts.push("");

  parts.push("── Current Draft Roadmap (source of truth for priorities + 90-day) ──");
  parts.push(String(draft || "(no draft present)"));
  parts.push("");

  parts.push("── Verified Financials (use VERIFIED FACT tags only on these) ──");
  if (vf.length === 0) {
    parts.push("(no verified entries — do not fabricate VF tags; say \"not yet validated\" where a number is needed)");
  } else {
    for (const e of vf) parts.push(formatVfForPrompt(e));
  }
  parts.push("");

  parts.push("── Paid-297 Intake (client's own words — use CLIENT-STATED tags) ──");
  if (answers.length === 0) {
    parts.push("(no intake answers surfaced)");
  } else {
    for (const a of answers) parts.push(`[field_key=${a.fieldKey}] ${a.label}:\n  ${a.value}`);
  }
  parts.push("");

  parts.push("── SERVICES (use these verbatim for SM tags; included and excluded) ──");
  if (!matches || (!matches.included?.length && !matches.excluded?.length)) {
    parts.push("(no service matches on the current signals; Section 7 says so plainly, Section 8 is empty)");
  } else {
    if (matches.included?.length) {
      parts.push("Included:");
      for (const r of matches.included) {
        const primary = r.matched_signals?.[0] || "";
        parts.push(`  - service_id=${r.service_id} · name=${r.name} · primary_signal=${primary} · problem_solved="${(r.problem_solved || "").replace(/"/g, "'")}"`);
      }
    }
    if (matches.excluded?.length) {
      parts.push("Excluded:");
      for (const r of matches.excluded) {
        parts.push(`  - service_id=${r.service_id} · name=${r.name} · excluded_by=${(r.excluded_by || []).join(",")}`);
      }
    }
  }
  if (catalogVersion) parts.push(`catalog_version=${catalogVersion}`);

  return parts.join("\n");
}

function formatVfForPrompt(entry) {
  const id = entry.metric_id;
  const v = entry.value;
  const valueStr = (v !== null && typeof v === "object") ? JSON.stringify(v) : String(v);
  const period = entry.period || "unknown-period";
  const source = entry.source_doc || "unknown-source";
  return `  - ${id} = ${valueStr}, period=${period}, source=${source}`;
}

/** Idempotent banner injection, same discipline as roadmap. */
export function wrapGeneratedPrepBrief(claudeOutput) {
  const body = String(claudeOutput || "").trim();
  if (body.startsWith(PREP_BRIEF_BANNER)) return body;
  return `${PREP_BRIEF_BANNER}\n\n${body}`;
}

/**
 * Parse prep-brief sections. Shape mirrors roadmap.parseDraftSections
 * so a future refactor can share one impl; kept inline here to keep
 * the prep-brief module standalone.
 */
export function parsePrepBriefSections(text) {
  const s = typeof text === "string" ? text : "";
  const re = /^##\s+Section\s+(\d+)\s*[—-]\s*(.+?)\s*$/gm;
  const matches = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    matches.push({ n: Number(m[1]), title: m[2], start: m.index, headerEnd: re.lastIndex });
  }
  const sections = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    sections.push({
      n: cur.n,
      title: cur.title,
      body: s.slice(cur.headerEnd, next ? next.start : s.length)
        .replace(/^[ \t]*\n/, "").replace(/\s+$/, ""),
    });
  }
  return { sections };
}

/**
 * Extract every [SM: service_id, signal=slug] tag out of a prep-brief
 * section's body. (Codex P1 on #98) Used to verify every SM tag binds
 * to a real included match + its catalog signal.
 */
export function extractSmTags(sectionBody) {
  const out = [];
  const re = /\[SM:\s*([a-z0-9_]+)\s*,\s*signal=([a-z0-9_]+)\s*\]/gi;
  const s = String(sectionBody || "");
  let m;
  while ((m = re.exec(s)) !== null) {
    out.push({ service_id: m[1], signal: m[2] });
  }
  return out;
}

/**
 * Validate a generated prep brief before writing. Rejects truncated
 * responses, malformed section layouts, and (Codex P1 on #98) any SM
 * tag in Section 7 that doesn't bind to a real included service +
 * one of its matched signals, or any SM tag at all in Section 8
 * (exclusions must not emit SM tags).
 *
 * `matches` is the output of `matchServices` from the same request —
 * same source of truth the prompt was built from.
 */
export function validateGeneratedPrepBrief(text, stopReason, { matches } = {}) {
  if (stopReason === "max_tokens") {
    return { ok: false, error: "Claude hit the max_tokens limit — prep brief truncated; re-run" };
  }
  const brief = wrapGeneratedPrepBrief(text);
  if (!brief.startsWith(PREP_BRIEF_BANNER)) {
    return { ok: false, error: "generated prep brief is missing the INTERNAL banner" };
  }
  const { sections } = parsePrepBriefSections(brief);
  if (sections.length !== PREP_BRIEF_SECTIONS.length) {
    return {
      ok: false,
      error: `generated prep brief has ${sections.length} sections, expected ${PREP_BRIEF_SECTIONS.length}`,
    };
  }
  for (let i = 0; i < PREP_BRIEF_SECTIONS.length; i++) {
    if (sections[i].n !== i + 1) {
      return {
        ok: false,
        error: `generated prep brief section order wrong: expected ${i + 1}, got ${sections[i].n}`,
      };
    }
  }

  // (Codex P1 on #98) Provenance guardrails on SM tags.
  // We validate ONLY when matches is provided; the pure helper is
  // called in tests without matches to exercise shape rules alone.
  if (matches && typeof matches === "object") {
    const section7 = sections.find((s) => s.n === 7);
    const section8 = sections.find((s) => s.n === 8);

    // Section 8 must NOT contain SM tags — exclusions aren't
    // recommendations, so emitting an SM tag there would wrongly
    // promote a disqualified service through downstream SM-grep audits.
    const section8Tags = extractSmTags(section8?.body || "");
    if (section8Tags.length > 0) {
      return {
        ok: false,
        error: "section 8 (excluded services) must not contain [SM:] tags",
      };
    }

    // Every Section 7 SM tag must bind to an included match.
    // Build a lookup of included service_id → set of matched signals,
    // then verify each (service_id, signal) pair.
    const includedById = new Map();
    for (const r of matches.included || []) {
      if (r && typeof r.service_id === "string") {
        includedById.set(r.service_id, new Set(Array.isArray(r.matched_signals) ? r.matched_signals : []));
      }
    }
    const section7Tags = extractSmTags(section7?.body || "");
    for (const tag of section7Tags) {
      const signalsForService = includedById.get(tag.service_id);
      if (!signalsForService) {
        return {
          ok: false,
          error: `section 7 SM tag binds to unknown service_id "${tag.service_id}" (not in matches.included)`,
        };
      }
      if (!signalsForService.has(tag.signal)) {
        return {
          ok: false,
          error: `section 7 SM tag "${tag.service_id}" uses signal "${tag.signal}" which did not match this case`,
        };
      }
    }
  }

  return { ok: true, brief };
}

/**
 * Dedicated Claude call for prep brief. Separate from the roadmap
 * call so a prompt change doesn't shift the diagnostic path.
 */
export async function callClaudeForPrepBrief(systemText, userText, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY not configured" };
  }
  const model = env.CLAUDE_MODEL || "claude-sonnet-4-6";
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": env.ANTHROPIC_VERSION || "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 3000,
        system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userText }],
      }),
    });
  } catch (err) {
    return { ok: false, error: `Claude fetch failed: ${err?.message || err}` };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `Claude API ${res.status}: ${detail.slice(0, 300)}` };
  }
  const data = await res.json().catch(() => null);
  const text = data?.content?.[0]?.text;
  if (!text) return { ok: false, error: "Claude response missing content[0].text" };
  return { ok: true, text, stop_reason: data?.stop_reason || null };
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
 * POST /asksolomon/case/generate-prep-brief
 *
 * Body: { contactId }
 *
 * Preconditions:
 *   - swot_paid_297 on the contact.
 *   - swot_growth_plan_draft is populated (the brief is a condensed
 *     view of the draft; refuse 400 otherwise).
 *
 * Side effects:
 *   - Writes swot_bga_prep_brief (the full brief text, banner included).
 *   - NO tags applied.
 */
export async function handleGeneratePrepBrief(request, env, { checkPassword }) {
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
    return json({ success: false, error: `contact is not tagged ${PAID_297_TAG}` }, 400);
  }

  let catalog = {};
  try { catalog = await fetchGHLCustomFieldsCatalog(env); }
  catch (e) { console.warn(`[prep_brief] catalog fetch: ${e?.message || e}`); }
  const idMap = buildFieldKeyToIdMap(catalog);

  const draft = readCustomField(contact, DRAFT_FIELD_KEY, idMap);
  if (!draft.trim()) {
    return json({
      success: false,
      error: "no draft present — run generate_roadmap_draft first",
    }, 400);
  }

  // Derive fresh service matches so the brief's Section 7/8 bind to
  // SM tags with real signal slugs. The strategist may not have run
  // match_services recently, and the brief shouldn't invent SM tags.
  const vfRaw = readCustomField(contact, "swot_verified_financials", idMap);
  const vfEntries = parseVerifiedFinancials(vfRaw);

  const bundle = assembleCaseBundle(contact, idMap, { contactId, catalog });

  const { signals, disqualifiers } = deriveCaseSignals({
    tags,
    verified_financials_entries: vfEntries,
    // (Codex P1 on #97) Intake answers surface qualifying conditions
    // the strategist may not have manually tagged — thread them here.
    paid_297_answers: bundle?.intake?.paid_297_answers || [],
  });
  const matches = matchServices({
    activeSignals: signals, activeDisqualifiers: disqualifiers,
  });
  const catalogVersion = await getServicesCatalogVersion();

  const systemText = buildPrepBriefSystemPrompt();
  const userText = buildPrepBriefUserPrompt(bundle, { draft, matches, catalogVersion });

  const claude = await callClaudeForPrepBrief(systemText, userText, env);
  if (!claude.ok) return json({ success: false, error: claude.error }, 503);

  // Codex P1 on #98: pass the match set so SM-tag provenance
  // guardrails fire — the validator rejects unknown service_ids,
  // signals Claude invented, and SM tags leaking into the
  // exclusions section.
  const validated = validateGeneratedPrepBrief(claude.text, claude.stop_reason, { matches });
  if (!validated.ok) return json({ success: false, error: validated.error }, 502);

  const brief = validated.brief;
  const wroteOk = await updateGhlCustomField(contactId, PREP_BRIEF_FIELD_KEY, brief, env);
  if (!wroteOk) return json({ success: false, error: "writeback to GHL failed" }, 503);

  return json({
    success: true,
    contactId,
    brief,
    active_signals: signals,
    active_disqualifiers: disqualifiers,
    catalog_version: catalogVersion,
    // Convenience echo for the UI: match counts match-services returned.
    matches_included_count: matches.included?.length || 0,
    matches_excluded_count: matches.excluded?.length || 0,
  });
}

// Re-export for test convenience (so tests import everything from one place).
export { PREP_BRIEF_FIELD_KEY };
