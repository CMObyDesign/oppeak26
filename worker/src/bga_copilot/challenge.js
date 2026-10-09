// BGA Copilot — challenge_roadmap (PR 8, docs/BGA_COPILOT_SPEC.md §4.5).
//
// Read-only adversarial self-review of the current roadmap draft.
// Takes the latest draft (post any edits), runs an LLM pass with
// explicit "poke holes" framing, returns a critique the strategist
// reads before the live call.
//
// Guardrails that must hold at every return:
//   - Password-gated.
//   - **Read-only**. Never issues a PUT. Never applies a tag.
//     Caller sees the critique; nothing persists.
//   - Requires swot_growth_plan_draft to be present — critique on
//     a non-existent draft is nonsense, refuse 400.

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

const DRAFT_FIELD_KEY = "swot_growth_plan_draft";
const PAID_297_TAG = "swot_paid_297";

/**
 * Builds the adversarial system prompt. Pins the specific "poke
 * holes" lenses spec §4.5 names so Claude's critique stays on-topic
 * (symptom-vs-cause, cash-supportable hires, catalog bias, priority
 * dependencies, 12-month certainty).
 *
 * The output format is a short structured critique — plain markdown,
 * no banner — the strategist reads top-to-bottom in under a minute.
 * We don't invent a provenance tag scheme here; the critique
 * references the draft's own numbered sections and existing tags.
 */
export function buildChallengeSystemPrompt() {
  return `You are a senior strategic reviewer. Your job is to find flaws in a Business Growth Analysis draft before it goes to a client. You are **not** rewriting the draft — you are stress-testing it. Pessimism is a feature. If the draft is right, your output is short and says so.

Read the current draft and the supporting verified financials + intake + service-catalog match context. Produce a critique organized by these lenses, in this order, as a plain markdown document (no banner, no greeting, no "DRAFT" wrapper):

## Lenses

### 1. Symptom vs. cause
Is this draft treating a symptom (slow collections, bad margin visibility, tax surprise) as the cause? Where might the real cause live upstream (pricing, sales mix, operating model)? Flag anything that pattern-matches to "fix the symptom; the cause stays."

### 2. Supportability from verified facts
For every recommended hire, investment, or spend commitment: does the verified financial position (cash, revenue, debt service, AR) actually support it? If a recommendation would push cash negative within 90 days, say so plainly with the VF reference. If verified financials are MISSING for a claim, say "not supportable from current VF" — never silently assume.

### 3. Catalog bias
For every service recommendation in Section 7: is the service matched because it genuinely fits this case, or because CFO By Design sells it? Reference the SM tag's signal — would a reasonable strategist outside the firm agree the signal applies here? If signals are weak, say so.

### 4. Priority dependencies
Do priorities in Section 3 or commitments in Section 4 depend on each other without saying so? (e.g. "collect AR" might depend on "fix books" first.) Any dependency the draft doesn't surface is a risk.

### 5. 12-month certainty
Section 6 is framed as goals / reassessment points. Any item presented as a certain outcome (rather than a goal to reassess) is wrong tone for the horizon — flag which ones.

## Verdict

End with a one-line verdict:

- **SHIP IT (minor refinements)** — if nothing above is a real risk.
- **REVISE** — if any lens surfaced a real concern. List which sections to edit.
- **BLOCK** — if a VF-supportability failure or a wrong recommendation would damage the client. Rare; use it when the draft would hurt the business as-is.

Rules:

- You MUST produce the five "Lenses" sections, in order, with the exact headings above. If a lens has nothing to flag, write one line saying so. Do NOT omit the section.
- You MUST end with a "## Verdict" section containing exactly one of the three verdict strings in bold, followed by a brief justification.
- Reference the draft's section numbers (e.g. "Section 3 item 2") instead of quoting long passages.
- Do NOT propose new SM tags, VF values, or client-facing copy. Your output is a critique, not a draft. The strategist edits sections afterward if they agree with you.
- Output ONLY the critique starting with "## Lenses". No preamble, no post-script.
`;
}

export function buildChallengeUserPrompt(bundle, { draft, matches, catalogVersion } = {}) {
  const vf = Array.isArray(bundle?.verified_financials?.entries)
    ? bundle.verified_financials.entries
    : [];
  const intake = bundle?.intake || {};
  const answers = Array.isArray(intake.paid_297_answers) ? intake.paid_297_answers : [];

  const parts = [];
  parts.push(`CASE: ${bundle?.business_name || "(no business name)"} · contactId=${bundle?.contactId}`);
  if (bundle?.classification) parts.push(`Classification: ${bundle.classification}`);
  if (bundle?.rehab_flag) parts.push("Rehab flag: true");
  parts.push("");

  parts.push("── Current Draft Roadmap (what you're critiquing) ──");
  parts.push(String(draft || "(no draft present)"));
  parts.push("");

  parts.push("── Verified Financials (anchor for supportability lens) ──");
  if (vf.length === 0) {
    parts.push("(no verified entries — supportability lens should say \"not supportable from current VF\" for every claim that would need a number)");
  } else {
    for (const e of vf) parts.push(formatVfForPrompt(e));
  }
  parts.push("");

  parts.push("── Paid-297 Intake (anchor for symptom-vs-cause lens) ──");
  if (answers.length === 0) {
    parts.push("(no intake answers surfaced)");
  } else {
    for (const a of answers) parts.push(`[field_key=${a.fieldKey}] ${a.label}:\n  ${a.value}`);
  }
  parts.push("");

  parts.push("── SERVICE MATCHES (anchor for catalog-bias lens) ──");
  if (!matches || (!matches.included?.length && !matches.excluded?.length)) {
    parts.push("(no service matches on the current signals)");
  } else {
    if (matches.included?.length) {
      parts.push("Included:");
      for (const r of matches.included) {
        const primary = r.matched_signals?.[0] || "";
        parts.push(`  - service_id=${r.service_id} · primary_signal=${primary}`);
      }
    }
    if (matches.excluded?.length) {
      parts.push("Excluded:");
      for (const r of matches.excluded) {
        parts.push(`  - service_id=${r.service_id} · excluded_by=${(r.excluded_by || []).join(",")}`);
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

/**
 * Validate the critique before returning. Rejects truncation and
 * ensures the five "## Lenses" sub-headings + "## Verdict" are
 * present — a critique that skipped a lens would silently let that
 * lens's risk through on this run.
 */
const REQUIRED_LENS_HEADINGS = Object.freeze([
  "### 1. Symptom vs. cause",
  "### 2. Supportability from verified facts",
  "### 3. Catalog bias",
  "### 4. Priority dependencies",
  "### 5. 12-month certainty",
]);

export function validateChallengeOutput(text, stopReason) {
  if (stopReason === "max_tokens") {
    return { ok: false, error: "Claude hit the max_tokens limit — critique truncated; re-run" };
  }
  const t = String(text || "");
  if (!t.includes("## Lenses")) {
    return { ok: false, error: "critique missing the '## Lenses' header" };
  }
  for (const h of REQUIRED_LENS_HEADINGS) {
    if (!t.includes(h)) return { ok: false, error: `critique missing lens heading: ${h}` };
  }
  if (!/##\s+Verdict/.test(t)) {
    return { ok: false, error: "critique missing the '## Verdict' section" };
  }
  // Verdict value must match exactly one of the three. Preserve the
  // bold-wrapped strings so a future red-team / audit path can grep.
  const verdictMatch = /\*\*(SHIP IT \(minor refinements\)|REVISE|BLOCK)\*\*/.exec(t);
  if (!verdictMatch) {
    return { ok: false, error: "critique verdict is not one of SHIP IT / REVISE / BLOCK (bolded)" };
  }
  return { ok: true, critique: t.trim(), verdict: verdictMatch[1] };
}

export async function callClaudeForChallenge(systemText, userText, env) {
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
        max_tokens: 2500,
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
 * POST /asksolomon/case/challenge-roadmap
 *
 * Body: { contactId }
 *
 * Preconditions:
 *   - swot_paid_297 on the contact.
 *   - swot_growth_plan_draft is populated (critique on nothing is
 *     nonsense; refuse 400 otherwise).
 *
 * Side effects: **none**. This endpoint reads two custom fields
 * (contact + customFields catalog) and makes one Claude call. It
 * does not issue a PUT and does not apply a tag.
 */
export async function handleChallengeRoadmap(request, env, { checkPassword }) {
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
  catch (e) { console.warn(`[challenge] catalog fetch: ${e?.message || e}`); }
  const idMap = buildFieldKeyToIdMap(catalog);

  const draft = readCustomField(contact, DRAFT_FIELD_KEY, idMap);
  if (!draft.trim()) {
    return json({
      success: false,
      error: "no draft present — run generate_roadmap_draft first",
    }, 400);
  }

  // Derive the same service matches as roadmap / prep-brief so the
  // catalog-bias lens has real signal data to argue against.
  const vfRaw = readCustomField(contact, "swot_verified_financials", idMap);
  const vfEntries = parseVerifiedFinancials(vfRaw);

  const bundle = assembleCaseBundle(contact, idMap, { contactId, catalog });

  const { signals, disqualifiers } = deriveCaseSignals({
    tags,
    verified_financials_entries: vfEntries,
    // (Codex P1 on #97) Union of tag + VF + intake-derived signals.
    paid_297_answers: bundle?.intake?.paid_297_answers || [],
  });
  const matches = matchServices({
    activeSignals: signals, activeDisqualifiers: disqualifiers,
  });
  const catalogVersion = await getServicesCatalogVersion();

  const systemText = buildChallengeSystemPrompt();
  const userText = buildChallengeUserPrompt(bundle, { draft, matches, catalogVersion });

  const claude = await callClaudeForChallenge(systemText, userText, env);
  if (!claude.ok) return json({ success: false, error: claude.error }, 503);

  const validated = validateChallengeOutput(claude.text, claude.stop_reason);
  if (!validated.ok) return json({ success: false, error: validated.error }, 502);

  return json({
    success: true,
    contactId,
    critique: validated.critique,
    verdict: validated.verdict,
    active_signals: signals,
    active_disqualifiers: disqualifiers,
    catalog_version: catalogVersion,
    // Explicit guardrail echo so a smoke tester can see no persistence happened.
    persisted: false,
  });
}
