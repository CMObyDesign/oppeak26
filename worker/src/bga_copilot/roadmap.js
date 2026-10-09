// BGA Copilot — roadmap draft (PR 5b of the build; docs/BGA_COPILOT_SPEC.md §4.3).
//
// Two endpoint handlers:
//   - handleGenerateRoadmapDraft  →  POST /asksolomon/case/generate-roadmap-draft
//   - handleUpdateRoadmapSection  →  POST /asksolomon/case/update-roadmap-section
//
// Guardrails that must hold at every return:
//   - Password-gated (checkConsolePassword).
//   - Writes ONLY `swot_growth_plan_draft` + applies the
//     `swot_growth_plan_drafted` tag. Never touches
//     `swot_growth_plan` or applies `swot_growth_plan_ready` — those
//     are the APPROVE & SEND button's domain (PR 12).
//   - The draft content always carries the "DRAFT · INTERNAL PREP
//     ONLY · NOT FOR CUSTOMER DELIVERY" banner at the top. The
//     builder enforces it; `red_team_check` (PR 10) will refuse to
//     send without the banner intact.
//   - Every material claim in the generated draft carries an inline
//     provenance tag per §3.1 (VERIFIED FACT / CLIENT-STATED /
//     STRATEGIST JUDGMENT / SERVICE MATCH). The system prompt tells
//     Claude the rule; `red_team_check` catches regressions.
//   - Section 7 (Service Recommendations) is a placeholder until PR 6
//     ships `match_services`. The placeholder makes the intent
//     visible without us faking SERVICE MATCH tags.
//
// Model note: the Worker already uses Claude in two patterns elsewhere
// (callClaude, callClaudeWithSystem). Those stay pinned to the SWOT
// rubric; this module makes its own Claude call so a BGA prompt
// change can't shift the diagnostic path.

import {
  fetchGhlContact,
  readCustomField,
  resolveFieldIdMap,
  json,
} from "./case_handlers.js";
import {
  assembleCaseBundle,
} from "./case_load.js";
import {
  fetchGHLCustomFieldsCatalog,
  buildFieldKeyToIdMap,
} from "../ghl_catalog.js";
import {
  getServicesCatalogVersion,
} from "./services_catalog.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const DRAFT_FIELD_KEY = "swot_growth_plan_draft";
const DRAFTED_TAG = "swot_growth_plan_drafted";
const PAID_297_TAG = "swot_paid_297";

export const DRAFT_BANNER =
  "⚠️ DRAFT · INTERNAL PREP ONLY · NOT FOR CUSTOMER DELIVERY ⚠️";

/**
 * The 8-section outline. Numbers are stable (section_number parameter
 * on update_roadmap_section targets these) and the titles are the
 * literal headings written into `swot_growth_plan_draft`.
 *
 * Section 7 is the service-recommendations slot that `match_services`
 * (PR 6) will populate. For PR 5b it's a placeholder that explicitly
 * says so, so a draft seen before PR 6 lands doesn't look broken.
 */
export const SECTIONS = Object.freeze([
  { n: 1, title: "Where You Are Now",
    guidance: "One-paragraph read of the business today, grounded in verified facts and client-stated context." },
  { n: 2, title: "Verified Financial Position",
    guidance: "Current snapshot of cash, revenue, margins, AR aging, debt — every number tagged VERIFIED FACT with metric + period + source doc." },
  { n: 3, title: "Priority Issues",
    guidance: "The 3–5 highest-leverage problems. Each carries VERIFIED FACT or CLIENT-STATED tags showing the evidence." },
  { n: 4, title: "90-Day Commitments",
    guidance: "The concrete work the next 90 days deliver. Each item points back to a priority issue in Section 3 by provenance." },
  { n: 5, title: "6-Month Direction",
    guidance: "What the 6-month view looks like if the 90-day commitments hold. Must be noticeably more developed than §4 (red-team warning 2 fires otherwise)." },
  { n: 6, title: "12-Month Goals / Reassessment",
    guidance: "Framed as goals / reassessment points, NOT as certainties. STRATEGIST JUDGMENT tags expected here; VERIFIED FACT is rare." },
  { n: 7, title: "Service Recommendations",
    guidance: "Populated by MATCH SERVICES (PR 6). For now, a placeholder line that says so." },
  { n: 8, title: "Open Questions / Decisions",
    guidance: "Unresolved items the strategist needs to raise on the call. Each with the question and the fact gap it depends on." },
]);

const SECTION_PLACEHOLDER_SECTION_7 =
  "_Placeholder._ Service recommendations are populated by " +
  "`match_services` (PR 6 of the build). Until that ships, the " +
  "strategist adds matches by hand via inline per-section edit, " +
  "with explicit `[SM: <service_id>, signal=<slug>]` provenance tags.";

/**
 * Builds the system prompt. Instructions Claude follows for every
 * draft: the sections to produce, the provenance-tag rules from §3.1,
 * and the banner.
 */
export function buildRoadmapSystemPrompt() {
  const sectionList = SECTIONS.map(
    (s) => `${s.n}. ${s.title} — ${s.guidance}`,
  ).join("\n");

  return `You are the senior strategist's internal case copilot drafting a BGA (Business Growth Analysis) roadmap. The output you produce is READ ONLY by the strategist — it is NEVER shown to the client in this form. The strategist edits it, runs it through the pre-send QA, and only then approves a cleaned customer-facing version.

Hard rules you MUST follow every time:

1. The very first line of your output is the DRAFT banner exactly as given, verbatim:
${DRAFT_BANNER}

2. Produce exactly 8 sections, in order, with these level-2 markdown headings and nothing else at level 2:
${SECTIONS.map((s) => `## Section ${s.n} — ${s.title}`).join("\n")}

Section guidance:
${sectionList}

3. Every material claim in the body carries an inline provenance tag drawn from this closed set:

   - [VF: <metric_id> = <value>, period=<p>, source=<doc>] — a verified financial entry the strategist recorded in swot_verified_financials. Only use metrics that appear in VERIFIED FINANCIALS below.
   - [CS: <question_slug>, from <field_key>, "<short quote or paraphrase>"] — the client's own words from the paid_297 intake narrative.
   - [SJ: <YYYY-MM-DDTHH:MM>, "<the judgment>"] — a conclusion the strategist entered (none for a fresh draft; use these only when the strategist's brief says one).
   - [SM: <service_id>, signal=<signal_slug>] — a service-catalog match. Reserve these for Section 7.

4. If a claim does not have an inline provenance tag, it is wrong by construction. When you cannot ground a claim, say so plainly ("not yet validated"), rather than inventing a tag.

5. Section 7 (Service Recommendations): write exactly the placeholder paragraph given at the end of this message. Do NOT fabricate SERVICE MATCH tags.

6. Internal-only tone throughout. Second-person "you/your" (addressing the client) is fine within the strategist's prep draft; the publishable customer version comes later. BUT do not use first-person claims like "I will…" or "my team will…" — the firm name is "CFO By Design", not a person.

7. Output ONLY the draft content starting with the banner. No preamble, no explanation, no post-script.

Here is the exact placeholder to use for Section 7 — paste it verbatim:

${SECTION_PLACEHOLDER_SECTION_7}
`;
}

/**
 * Build the user-turn content fed to Claude. Collects the bundle
 * fields it needs. Not a transcript — just the data.
 */
export function buildRoadmapUserPrompt(bundle, { catalogVersion } = {}) {
  const vf = (bundle.verified_financials && Array.isArray(bundle.verified_financials.entries))
    ? bundle.verified_financials.entries
    : [];
  const intake = bundle.intake || {};
  const answers = Array.isArray(intake.paid_297_answers) ? intake.paid_297_answers : [];

  const parts = [];
  parts.push(`CASE: ${bundle.business_name || "(no business name set)"} · contactId=${bundle.contactId}`);
  parts.push(`Classification: ${bundle.classification}`);
  if (bundle.rehab_flag) parts.push("Rehab flag: true");
  if (bundle.opportunity_flags && bundle.opportunity_flags.length) {
    parts.push(`Opportunity flags: ${bundle.opportunity_flags.join(", ")}`);
  }
  parts.push("");

  parts.push("── Verified Financials (use VERIFIED FACT tags only on these) ──");
  if (vf.length === 0) {
    parts.push("(no verified entries yet — do not fabricate VF tags; say \"not yet validated\" where a number is needed)");
  } else {
    for (const e of vf) {
      parts.push(formatVfForPrompt(e));
    }
  }
  parts.push("");

  parts.push("── Paid-297 Intake (client's own words — use CLIENT-STATED tags) ──");
  if (answers.length === 0) {
    parts.push("(no intake answers surfaced)");
  } else {
    for (const a of answers) {
      parts.push(`[field_key=${a.fieldKey}] ${a.label}:\n  ${a.value}`);
    }
  }
  parts.push("");

  parts.push("── Part 1 Business Growth Analysis (business_playbook) ──");
  parts.push(intake.business_playbook || "(not present)");
  parts.push("");

  parts.push("── Strategist Brief (internal) ──");
  parts.push(intake.strategist_brief || "(not present)");
  parts.push("");

  if (intake.full_diagnostic) {
    parts.push("── Prior Full Diagnostic ──");
    parts.push(intake.full_diagnostic);
    parts.push("");
  }

  parts.push("── Services Catalog ──");
  if (catalogVersion) {
    parts.push(`catalog_version=${catalogVersion}`);
    parts.push("(Section 7 is the match_services placeholder for PR 5b; do not reference catalog entries directly.)");
  } else {
    parts.push("(no catalog content loaded yet — Section 7 placeholder as instructed)");
  }

  return parts.join("\n");
}

function formatVfForPrompt(entry) {
  const id = entry.metric_id;
  const v = entry.value;
  let valueStr;
  if (v !== null && typeof v === "object") {
    valueStr = JSON.stringify(v);
  } else {
    valueStr = String(v);
  }
  const period = entry.period || "unknown-period";
  const source = entry.source_doc || "unknown-source";
  const note = entry.note ? ` note="${String(entry.note).replace(/"/g, "'")}"` : "";
  return `  - ${id} = ${valueStr}, period=${period}, source=${source}${note}`;
}

/**
 * The authoritative builder for a brand-new draft. Takes the output of
 * Claude's generation and wraps it with the banner. Used from the
 * handler; separate from the handler so tests can exercise the shape
 * without stubbing Claude.
 */
export function wrapGeneratedDraft(claudeOutput) {
  const body = String(claudeOutput || "").trim();
  // Idempotent banner injection: if Claude's output starts with the
  // banner (as instructed), use it as-is. Otherwise prepend. This
  // keeps red-team's "banner present" blocker safe even if Claude
  // drops it.
  if (body.startsWith(DRAFT_BANNER)) return body;
  return `${DRAFT_BANNER}\n\n${body}`;
}

/**
 * Parse the draft into { sections: [{ n, title, body }], prefix }.
 * `prefix` is the content before the first `## Section N — ...`
 * heading, which carries the banner on a well-formed draft.
 *
 * Section bodies include everything from the heading through the next
 * `## Section ` heading or end-of-text. The parser is tolerant: a
 * heading we don't recognize (title drift) is still captured by number.
 */
export function parseDraftSections(draft) {
  const text = typeof draft === "string" ? draft : "";
  const re = /^##\s+Section\s+(\d+)\s*[—-]\s*(.+?)\s*$/gm;
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    matches.push({ n: Number(m[1]), title: m[2], start: m.index, headerEnd: re.lastIndex });
  }

  const sections = [];
  const prefixEnd = matches.length ? matches[0].start : text.length;
  const prefix = text.slice(0, prefixEnd);

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const bodyStart = cur.headerEnd;
    const bodyEnd = next ? next.start : text.length;
    sections.push({
      n: cur.n,
      title: cur.title,
      body: text.slice(bodyStart, bodyEnd).replace(/^[ \t]*\n/, "").replace(/\s+$/, ""),
    });
  }

  return { prefix, sections };
}

/**
 * Replace the body of section N in `draft` with `newBody`. Leaves
 * every other section (and the banner / prefix) untouched. If N isn't
 * found in the current draft, returns `null` and the caller should
 * refuse with 404 — never append a new section silently.
 */
export function replaceSectionBody(draft, sectionNumber, newBody) {
  const { prefix, sections } = parseDraftSections(draft);
  const idx = sections.findIndex((s) => s.n === sectionNumber);
  if (idx === -1) return null;
  sections[idx] = { ...sections[idx], body: String(newBody || "").replace(/\s+$/, "") };

  const out = [];
  out.push(prefix.replace(/\s+$/, ""));
  for (const s of sections) {
    out.push("");
    out.push(`## Section ${s.n} — ${s.title}`);
    out.push("");
    out.push(s.body);
  }
  return out.join("\n") + "\n";
}

/**
 * Low-level Claude call. Pinned to the BGA roadmap system prompt and
 * a dedicated max_tokens budget so a change here doesn't shift the
 * SWOT diagnostic path.
 */
export async function callClaudeForRoadmap(systemText, userText, env) {
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
        max_tokens: 4000,
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

/**
 * Validates a generated draft before it's committed to GHL. Codex P2
 * on #96, finding 1: a truncated response (stop_reason="max_tokens")
 * or a response that didn't parse into exactly 8 sections should not
 * be saved as a "finished" draft and should not apply the
 * `swot_growth_plan_drafted` call-ready tag.
 *
 * Returns `{ ok: true, draft }` on success, or `{ ok: false, error }`
 * on reject.
 */
export function validateGeneratedDraft(text, stopReason) {
  if (stopReason === "max_tokens") {
    return { ok: false, error: "Claude hit the max_tokens limit — draft truncated; re-run" };
  }
  const draft = wrapGeneratedDraft(text);
  if (!draft.startsWith(DRAFT_BANNER)) {
    return { ok: false, error: "generated draft is missing the DRAFT banner" };
  }
  const { sections } = parseDraftSections(draft);
  if (sections.length !== SECTIONS.length) {
    return {
      ok: false,
      error: `generated draft has ${sections.length} sections, expected ${SECTIONS.length}`,
    };
  }
  // Section numbers must be 1..SECTIONS.length in order.
  for (let i = 0; i < SECTIONS.length; i++) {
    if (sections[i].n !== i + 1) {
      return {
        ok: false,
        error: `generated draft section order wrong: expected ${i + 1}, got ${sections[i].n}`,
      };
    }
  }
  return { ok: true, draft };
}

/**
 * GHL write helpers. Local copies kept intentionally — case_handlers
 * exports helpers but these two are specific to the draft tag write
 * path (which adds a tag, not a custom field).
 */
async function updateGhlCustomField(contactId, fieldKey, value, env) {
  return updateGhlCustomFields(contactId, [{ key: fieldKey, value }], env);
}

/**
 * Atomic multi-field write — same contract as the single-field
 * helper but takes `[{ key, value }, ...]`. (Codex P2 on #97) Used
 * when draft + catalog_ref need to land in the same PUT so a partial
 * write doesn't leave the audit record disagreeing with the content.
 */
async function updateGhlCustomFields(contactId, fields, env) {
  if (!env.GHL_API_KEY) return false;
  if (!Array.isArray(fields) || fields.length === 0) return false;
  try {
    const res = await fetch(`${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GHL_API_KEY}`,
        Version: "2021-07-28",
      },
      body: JSON.stringify({
        customFields: fields.map((f) => ({ key: f.key, field_value: f.value })),
      }),
    });
    return res.ok;
  } catch { return false; }
}

async function applyGhlTag(contactId, tag, env) {
  if (!env.GHL_API_KEY) return false;
  try {
    const res = await fetch(`${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}/tags`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GHL_API_KEY}`,
        Version: "2021-07-28",
      },
      body: JSON.stringify({ tags: [tag] }),
    });
    return res.ok;
  } catch { return false; }
}

/**
 * POST /asksolomon/case/generate-roadmap-draft
 *
 * Body: { contactId }
 *
 * Response (200): { success, contactId, draft, drafted_tag_applied }
 * Refusals: 401 unauth, 400 bad input / not paid_297, 503 GHL /
 *           Claude failure, 502 on bad Claude output.
 */
export async function handleGenerateRoadmapDraft(request, env, { checkPassword }) {
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

  // Build the bundle the same way /case/load does, so the prompt
  // sees the same shape the strategist sees in the UI.
  let catalog = {};
  try { catalog = await fetchGHLCustomFieldsCatalog(env); }
  catch (e) { console.warn(`[roadmap] catalog fetch: ${e?.message || e}`); }
  const idMap = buildFieldKeyToIdMap(catalog);
  const bundle = assembleCaseBundle(contact, idMap, { contactId, catalog });

  // (Codex P2 on #97) The catalog version used for THIS draft becomes
  // the authoritative `swot_bga_services_catalog_ref` for the case —
  // written atomically alongside the draft below so the audit record
  // is never out of sync with the content it describes.
  const catalogVersion = await getServicesCatalogVersion();

  const systemText = buildRoadmapSystemPrompt();
  const userText = buildRoadmapUserPrompt(bundle, { catalogVersion });

  const claude = await callClaudeForRoadmap(systemText, userText, env);
  if (!claude.ok) return json({ success: false, error: claude.error }, 503);

  // Codex P2 on #96: validate before any writeback. A truncated or
  // malformed response must not land as a "finished" draft and must
  // not trigger the swot_growth_plan_drafted call-ready tag.
  const validated = validateGeneratedDraft(claude.text, claude.stop_reason);
  if (!validated.ok) return json({ success: false, error: validated.error }, 502);
  const draft = validated.draft;

  // Write the draft field + catalog_ref atomically, then apply the
  // drafted tag. The field write must succeed to count as a complete
  // generation; the drafted tag is the signal HL / other tools use
  // to know "prep done; call-ready."
  const wroteField = await updateGhlCustomFields(contactId, [
    { key: DRAFT_FIELD_KEY, value: draft },
    { key: "swot_bga_services_catalog_ref", value: catalogVersion },
  ], env);
  if (!wroteField) return json({ success: false, error: "writeback to GHL failed" }, 503);

  const taggedOk = await applyGhlTag(contactId, DRAFTED_TAG, env);
  // Tag failure doesn't invalidate the draft itself — the draft is
  // saved. Surface the tag miss so the UI can retry it independently.
  return json({
    success: true,
    contactId,
    draft,
    drafted_tag_applied: taggedOk,
  });
}

/**
 * POST /asksolomon/case/update-roadmap-section
 *
 * Body: { contactId, section_number: 1–8, new_content: string }
 *
 * Replaces only the body of the named section. Returns 404 if that
 * section is missing from the current draft (never silently appends).
 */
export async function handleUpdateRoadmapSection(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  if (!contactId) return json({ success: false, error: "contactId required" }, 400);

  const n = Number(body.section_number);
  if (!Number.isInteger(n) || n < 1 || n > SECTIONS.length) {
    return json({ success: false, error: `section_number must be an integer 1–${SECTIONS.length}` }, 400);
  }

  if (typeof body.new_content !== "string" || !body.new_content.trim()) {
    return json({ success: false, error: "new_content required" }, 400);
  }

  const { contact, error } = await fetchGhlContact(contactId, env);
  if (!contact) return json({ success: false, error: error || "contact fetch failed" }, 503);

  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  if (!tags.includes(PAID_297_TAG)) {
    return json({ success: false, error: `contact is not tagged ${PAID_297_TAG}` }, 400);
  }

  const idMap = await resolveFieldIdMap(env);
  const currentDraft = readCustomField(contact, DRAFT_FIELD_KEY, idMap);
  if (!currentDraft.trim()) {
    return json({ success: false, error: "no draft present — run generate_roadmap_draft first" }, 400);
  }

  const nextDraft = replaceSectionBody(currentDraft, n, body.new_content);
  if (nextDraft === null) {
    return json({ success: false, error: `section ${n} not found in current draft` }, 404);
  }

  const wrote = await updateGhlCustomField(contactId, DRAFT_FIELD_KEY, nextDraft, env);
  if (!wrote) return json({ success: false, error: "writeback to GHL failed" }, 503);

  return json({ success: true, contactId, draft: nextDraft, section_number: n });
}
