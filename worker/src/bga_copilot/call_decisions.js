// BGA Copilot — extract_call_decisions (PR 9, docs/BGA_COPILOT_SPEC.md §4.7).
//
// Two-stage flow:
//   1. `extract-call-decisions` — reads free-form call notes, calls
//      Claude, returns a parsed structured record. Nothing is
//      committed. The strategist reviews what the model heard.
//   2. `confirm-call-decisions` — writes the strategist-confirmed
//      structure to `swot_bga_decisions` and the selected service_ids
//      to `swot_bga_services_selected`. Atomic multi-field PUT.
//
// Guardrails that must hold at every return:
//   - Password-gated.
//   - Extract is READ-ONLY: no PUT, no tag.
//   - Confirm writes ONLY the two fields above. Never touches
//     `swot_growth_plan`, `swot_growth_plan_ready`, or any tag.
//   - Confirm validates every service_id in services_selected
//     against the catalog — a hand-edited unknown id is rejected,
//     not silently stored.

import {
  fetchGhlContact,
  json,
} from "./case_handlers.js";
import {
  _effectiveCatalog,
} from "./services_catalog.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const DECISIONS_FIELD_KEY = "swot_bga_decisions";
const SERVICES_SELECTED_FIELD_KEY = "swot_bga_services_selected";
const PAID_297_TAG = "swot_paid_297";

/**
 * The 11 sections per spec §4.7, in order. The structured record
 * returned by `extract-call-decisions` has one key per slug. Each
 * value is an array of strings (items pulled from the notes); the
 * caller is free to render them however they like. Pinned here so a
 * schema drift surfaces as a test regression.
 */
export const CALL_DECISIONS_SECTIONS = Object.freeze([
  "priorities_confirmed",
  "priorities_changed",
  "client_corrections",
  "ninety_day_commitments",
  "six_month_direction",
  "twelve_month_goals",
  "next_steps",
  "services_discussed",
  "services_selected",
  "services_declined_or_deferred",
  "follow_up_needed",
]);

export function buildCallDecisionsSystemPrompt() {
  return `You are the senior strategist's internal call-notes parser. Take the raw notes the strategist pasted after a live BGA call and produce a structured JSON record of what was decided.

Hard rules you MUST follow every time:

1. Output ONLY a single valid JSON object. No preamble, no markdown fence, no explanation.

2. The object has exactly these keys, in this order, each mapping to an array of short strings pulled from the notes (one item per bullet):
${CALL_DECISIONS_SECTIONS.map((s) => `   - ${s}`).join("\n")}

3. If a section has nothing in the notes, use an empty array []. Never invent items. Never move items between sections.

4. For \`services_selected\` and \`services_declined_or_deferred\`: each item should be the service_id as it appears in the SERVICES CATALOG passed in the user turn, NOT the display name. If the notes name a service that isn't in the catalog, put the catalog-closest match in the right section AND add a note under \`follow_up_needed\` ("catalog mismatch for '<raw name>'"). The confirmed/declined categories feed downstream endpoint writes — invented service_ids break the write.

5. Keep items short — strategists are reviewing this screen. One line each. No nested JSON. No section headings inside item strings.

6. Do NOT output provenance tags in this record. Provenance applies to the roadmap draft and prep brief; the decisions log is the raw record of what the call produced.

7. Output ONLY the JSON object. If you cannot parse something, drop it rather than guessing.
`;
}

export function buildCallDecisionsUserPrompt({ notes, catalogServiceIds } = {}) {
  const parts = [];
  parts.push("── Call Notes (verbatim from strategist) ──");
  parts.push(String(notes || "(no notes provided)"));
  parts.push("");
  parts.push("── SERVICES CATALOG (service_ids you may use) ──");
  if (Array.isArray(catalogServiceIds) && catalogServiceIds.length) {
    for (const id of catalogServiceIds) parts.push(`  - ${id}`);
  } else {
    parts.push("(catalog empty — leave services_selected and services_declined_or_deferred as [])");
  }
  return parts.join("\n");
}

/**
 * Parse Claude's output into the record. Tolerates a stray code fence
 * (` ```json ... ``` `) and extra whitespace around the JSON.
 * Rejects anything that isn't the exact 11-key shape.
 */
export function parseAndValidateExtracted(text, stopReason) {
  if (stopReason === "max_tokens") {
    return { ok: false, error: "Claude hit the max_tokens limit — notes truncated; re-run" };
  }
  let raw = String(text || "").trim();
  // Strip a leading / trailing ```json fence if present.
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(raw);
  if (fenceMatch) raw = fenceMatch[1].trim();

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { return { ok: false, error: `extracted output is not valid JSON: ${e?.message || e}` }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "extracted output is not a JSON object" };
  }

  const record = {};
  for (const slug of CALL_DECISIONS_SECTIONS) {
    const value = parsed[slug];
    if (value === undefined) {
      return { ok: false, error: `missing section: ${slug}` };
    }
    if (!Array.isArray(value)) {
      return { ok: false, error: `section ${slug} is not an array` };
    }
    const cleaned = [];
    for (const item of value) {
      if (typeof item !== "string") {
        return { ok: false, error: `section ${slug} contains a non-string item` };
      }
      const trimmed = item.trim();
      if (trimmed) cleaned.push(trimmed);
    }
    record[slug] = cleaned;
  }

  // Reject stray keys so a model that invents a new category can't
  // slip past the strategist unnoticed.
  const extras = Object.keys(parsed).filter((k) => !CALL_DECISIONS_SECTIONS.includes(k));
  if (extras.length > 0) {
    return { ok: false, error: `extracted output has unknown keys: ${extras.join(", ")}` };
  }
  return { ok: true, record };
}

async function callClaudeForCallDecisions(systemText, userText, env) {
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

/**
 * POST /asksolomon/case/extract-call-decisions
 *
 * Body: { contactId, notes }
 *
 * Side effects: **none**. Returns the parsed structured record for
 * strategist review. Spec §4.7: "Nothing is committed until the
 * strategist confirms it."
 */
export async function handleExtractCallDecisions(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  if (!contactId) return json({ success: false, error: "contactId required" }, 400);
  const notes = typeof body.notes === "string" ? body.notes : "";
  if (!notes.trim()) return json({ success: false, error: "notes required" }, 400);

  const { contact, error } = await fetchGhlContact(contactId, env);
  if (!contact) return json({ success: false, error: error || "contact fetch failed" }, 503);

  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  if (!tags.includes(PAID_297_TAG)) {
    return json({ success: false, error: `contact is not tagged ${PAID_297_TAG}` }, 400);
  }

  const catalogServiceIds = (_effectiveCatalog() || [])
    .map((e) => e && typeof e.service_id === "string" ? e.service_id : null)
    .filter((id) => id);

  const systemText = buildCallDecisionsSystemPrompt();
  const userText = buildCallDecisionsUserPrompt({ notes, catalogServiceIds });

  const claude = await callClaudeForCallDecisions(systemText, userText, env);
  if (!claude.ok) return json({ success: false, error: claude.error }, 503);

  const parsed = parseAndValidateExtracted(claude.text, claude.stop_reason);
  if (!parsed.ok) return json({ success: false, error: parsed.error }, 502);

  return json({
    success: true,
    contactId,
    record: parsed.record,
    catalog_service_ids: catalogServiceIds,
    persisted: false,
  });
}

/**
 * POST /asksolomon/case/confirm-call-decisions
 *
 * Body: { contactId, decisions, services_selected }
 *   - decisions: the full 11-key record (strategist may have edited
 *     any section). Stored as JSON string in swot_bga_decisions.
 *   - services_selected: array of service_id strings. Each must appear
 *     in the catalog. Stored as JSON string in swot_bga_services_selected.
 *
 * Writes both fields atomically in a single PUT. No tags applied.
 */
export async function handleConfirmCallDecisions(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  if (!contactId) return json({ success: false, error: "contactId required" }, 400);

  const incoming = body.decisions;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return json({ success: false, error: "decisions required (object with the 11 section keys)" }, 400);
  }
  // Validate shape — same contract as extract output. Prevents a
  // hand-edited UI from writing a drift-shaped record.
  const record = {};
  for (const slug of CALL_DECISIONS_SECTIONS) {
    const v = incoming[slug];
    if (v === undefined) return json({ success: false, error: `missing section: ${slug}` }, 400);
    if (!Array.isArray(v)) return json({ success: false, error: `section ${slug} is not an array` }, 400);
    const cleaned = [];
    for (const item of v) {
      if (typeof item !== "string") return json({ success: false, error: `section ${slug} contains a non-string item` }, 400);
      const t = item.trim();
      if (t) cleaned.push(t);
    }
    record[slug] = cleaned;
  }
  const extras = Object.keys(incoming).filter((k) => !CALL_DECISIONS_SECTIONS.includes(k));
  if (extras.length > 0) {
    return json({ success: false, error: `decisions has unknown keys: ${extras.join(", ")}` }, 400);
  }

  // services_selected is a parallel field — accept either body-level
  // or body.decisions.services_selected (prefer body-level if present
  // since the strategist may have edited it after extraction).
  let servicesSelected;
  if (Array.isArray(body.services_selected)) {
    servicesSelected = body.services_selected;
  } else {
    servicesSelected = record.services_selected;
  }
  if (!Array.isArray(servicesSelected)) {
    return json({ success: false, error: "services_selected must be an array of service_id strings" }, 400);
  }
  // Validate every service_id against the catalog.
  const catalog = _effectiveCatalog() || [];
  const catalogIds = new Set(
    catalog.map((e) => e && typeof e.service_id === "string" ? e.service_id : null)
      .filter((id) => id),
  );
  const cleanedSelected = [];
  for (const id of servicesSelected) {
    if (typeof id !== "string" || !id.trim()) {
      return json({ success: false, error: "services_selected contains a non-string / empty entry" }, 400);
    }
    const t = id.trim();
    if (!catalogIds.has(t)) {
      return json({
        success: false,
        error: `services_selected contains unknown service_id "${t}" (not in catalog)`,
      }, 400);
    }
    cleanedSelected.push(t);
  }
  // Dedupe while preserving first-seen order.
  const dedupedSelected = [...new Set(cleanedSelected)];

  const { contact, error } = await fetchGhlContact(contactId, env);
  if (!contact) return json({ success: false, error: error || "contact fetch failed" }, 503);

  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  if (!tags.includes(PAID_297_TAG)) {
    return json({ success: false, error: `contact is not tagged ${PAID_297_TAG}` }, 400);
  }

  // Keep the services_selected field in the saved decisions record
  // in sync with the body-level selection, so a later read-back of
  // swot_bga_decisions matches the swot_bga_services_selected field.
  record.services_selected = dedupedSelected;

  const wrote = await updateGhlCustomFields(contactId, [
    { key: DECISIONS_FIELD_KEY, value: JSON.stringify(record) },
    { key: SERVICES_SELECTED_FIELD_KEY, value: JSON.stringify(dedupedSelected) },
  ], env);
  if (!wrote) return json({ success: false, error: "writeback to GHL failed" }, 503);

  return json({
    success: true,
    contactId,
    decisions: record,
    services_selected: dedupedSelected,
  });
}
