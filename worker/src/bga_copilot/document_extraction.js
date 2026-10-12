// BGA Copilot — document extraction (PR 14, docs/BGA_COPILOT_SPEC.md §11 row 14).
//
// Reads an uploaded financial document (PDF / CSV) and asks Claude to
// extract candidate values for the canonical verified-financials
// metrics. The handler NEVER writes to swot_verified_financials — it
// only returns candidates for the strategist to review in the UI.
//
// From there, the UI's [VERIFY] or [EDIT] action POSTs through the
// existing /case/verified-financials endpoint, which runs the §4.2
// hash-based concurrency check and sets `provenance: "verified"`. So:
//
//   - A rejected candidate NEVER touches swot_verified_financials.
//   - An accepted/edited candidate takes the same write path a
//     hand-entered row would — same concurrency guard, same validation,
//     same provenance="verified" stamp. Spec §11 row 14's constraint
//     ("only verified values enter swot_verified_financials") is met
//     by routing through the existing write handler, not by this
//     module writing anything directly.
//
// Guardrails that must hold at every return:
//   - Password-gated (checkConsolePassword).
//   - swot_paid_297 required on the contact.
//   - Never writes any GHL field. Never applies any tag. This is a
//     READ-ONLY tool that produces candidate rows for strategist
//     review.
//   - Rejects unsupported mime types up front — only PDFs and CSVs
//     are handled. XLSX is explicitly refused (don't want to run a
//     heavy xlsx parser inside a Workers isolate).

import {
  fetchGhlContact,
  json,
} from "./case_handlers.js";
import {
  CANONICAL_METRICS,
  CANONICAL_METRIC_IDS,
  validateMetricValue,
} from "./metrics.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const PAID_297_TAG = "swot_paid_297";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per document

const SUPPORTED_MIME_TYPES = Object.freeze({
  "application/pdf": "pdf",
  "text/csv": "csv",
});

const BANNED_MIME_TYPES_WITH_HINTS = Object.freeze({
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "XLSX is not supported in-worker — export the sheet to CSV or PDF first.",
  "application/vnd.ms-excel":
    "Legacy XLS is not supported — export the sheet to CSV or PDF first.",
  "application/msword":
    "DOC/DOCX is not supported — convert to PDF first.",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "DOCX is not supported — convert to PDF first.",
});

export { SUPPORTED_MIME_TYPES };

/**
 * Decode base64 → byte length (without materializing the bytes twice).
 * We use this to enforce MAX_BYTES before handing to Claude.
 */
function base64ByteLength(b64) {
  if (typeof b64 !== "string") return 0;
  const trimmed = b64.replace(/\s+/g, "");
  if (!trimmed) return 0;
  const padding = (trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0);
  return Math.floor((trimmed.length * 3) / 4) - padding;
}

/**
 * The system prompt for Claude. Pins the output shape and the canonical
 * metric ids so the model can't invent new metric slugs or free-form
 * guesses.
 */
export function buildExtractionSystemPrompt() {
  const metricLines = CANONICAL_METRIC_IDS.map((id) => {
    const spec = CANONICAL_METRICS[id];
    return `  - ${id} (${spec.shape}, ${spec.unit}): ${spec.label}`;
  }).join("\n");

  return [
    "You extract financial metric candidates from the uploaded document for a strategist to review.",
    "",
    "You are NOT the final record. The strategist clicks VERIFY, EDIT, or REJECT on each candidate. Only after that does a value enter the verified-financials record.",
    "",
    "Return STRICT JSON matching this shape (no markdown fences, no prose outside the JSON):",
    "",
    "{",
    '  "candidates": [',
    "    {",
    '      "metric_id": "<one of the canonical ids below>",',
    '      "value": <number | ar-aging object | enum string | free-form string, per the metric\'s shape>,',
    '      "period": "<the period the value covers, e.g. 2026-09, 2026-Q3, 2025-TTM — a human-readable period label>",',
    '      "source_doc": "<the originating filename or a page reference inside the uploaded document>",',
    '      "note": "<optional short note on where in the document you read this>",',
    '      "confidence": "high" | "medium" | "low"',
    "    }",
    "  ]",
    "}",
    "",
    "Canonical metric ids and shapes:",
    metricLines,
    "",
    "Value shapes:",
    "  - number: a finite JSON number (no units suffix, no commas; dollars are plain numbers, percentages are 0–100).",
    "  - ar_aging: an object {\"d30\": number, \"d60\": number, \"d90_plus\": number} where every bucket is >= 0.",
    "  - tax_enum: one of \"current\", \"behind\", \"in_default\".",
    "  - text: a non-empty short string (used for debt_terms only — rate, maturity, covenants, prepay penalties, personal guarantees).",
    "",
    "Rules:",
    "  1. Emit at most ONE candidate per metric_id — the most defensible value you can read in the document for that metric. Do not emit duplicates.",
    "  2. Only emit candidates for values you can locate in the document. Omit a metric entirely when the document does not state it; do not guess or interpolate.",
    "  3. Prefer the most recent period present in the document, and name the exact period in `period`.",
    "  4. Set `confidence`: `high` if the value is labeled with the metric's name verbatim, `medium` if it is a near-synonym or requires one obvious arithmetic step, `low` if interpretation is ambiguous.",
    "  5. Set `source_doc` to the uploaded document's filename (passed to you in the user turn). If the document has page/sheet labels, add them in `note`.",
    "  6. Do NOT output anything other than the JSON object. No commentary, no apology, no explanation.",
  ].join("\n");
}

export function buildExtractionUserPrompt({ filename, csvText }) {
  const parts = [];
  parts.push(`Document filename: ${filename}`);
  if (csvText) {
    parts.push("Document type: CSV");
    parts.push("");
    parts.push("--- BEGIN CSV ---");
    parts.push(csvText);
    parts.push("--- END CSV ---");
  }
  parts.push("");
  parts.push("Extract candidate values for the canonical metrics per the system instructions. Return the strict JSON object only.");
  return parts.join("\n");
}

/**
 * Validate Claude's response against the §4.2 metric schema. Returns:
 *   { ok: true, candidates: [...] }  — each candidate shape-checked
 *   { ok: false, error: "<msg>" }
 */
export function validateExtractionResponse(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) {
    return { ok: false, error: "empty response from Claude" };
  }
  // Tolerate a stray ```json fence.
  let text = rawText.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*\n/, "").replace(/\n```\s*$/, "");
  }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { return { ok: false, error: "Claude response is not valid JSON" }; }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "Claude response is not a JSON object" };
  }
  const list = parsed.candidates;
  if (!Array.isArray(list)) {
    return { ok: false, error: "Claude response missing `candidates` array" };
  }
  const seen = new Set();
  const candidates = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const metric_id = typeof c.metric_id === "string" ? c.metric_id.trim() : "";
    if (!metric_id || !CANONICAL_METRIC_IDS.includes(metric_id)) {
      // Skip unknown metric_ids rather than refusing the whole batch —
      // the strategist still gets the useful candidates.
      continue;
    }
    if (seen.has(metric_id)) continue; // dedupe by metric_id
    const vcheck = validateMetricValue(metric_id, c.value);
    if (!vcheck.ok) continue; // skip malformed values
    const period = typeof c.period === "string" ? c.period.trim() : "";
    const source_doc = typeof c.source_doc === "string" ? c.source_doc.trim() : "";
    if (!period || !source_doc) continue; // required fields
    const note = typeof c.note === "string" ? c.note.trim() : "";
    let confidence = typeof c.confidence === "string" ? c.confidence.toLowerCase().trim() : "medium";
    if (!["high", "medium", "low"].includes(confidence)) confidence = "medium";
    seen.add(metric_id);
    candidates.push({
      metric_id,
      value: c.value,
      period,
      source_doc,
      note,
      confidence,
    });
  }
  return { ok: true, candidates };
}

async function callClaudeForExtraction({ systemText, filename, mime, kind, docBase64, csvText, env }) {
  if (!env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY not configured", status: 503 };
  }
  const model = env.CLAUDE_MODEL || DEFAULT_MODEL;
  const userText = buildExtractionUserPrompt({ filename, csvText: kind === "csv" ? csvText : null });
  const userContent = [];
  if (kind === "pdf") {
    // Claude's native PDF input via the document content block.
    userContent.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: docBase64,
      },
    });
  }
  userContent.push({ type: "text", text: userText });

  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
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
        messages: [{ role: "user", content: userContent }],
      }),
    });
  } catch (err) {
    return { ok: false, error: `Claude fetch failed: ${err?.message || err}`, status: 503 };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return {
      ok: false,
      error: `Claude API ${res.status}: ${detail.slice(0, 300)}`,
      status: 503,
    };
  }
  const data = await res.json().catch(() => null);
  const text = data?.content?.find((b) => b && b.type === "text")?.text || data?.content?.[0]?.text;
  if (!text) {
    return { ok: false, error: "Claude response missing content[0].text", status: 502 };
  }
  return { ok: true, text, stop_reason: data?.stop_reason || null };
}

/**
 * POST /asksolomon/case/extract-financials-from-document
 *
 * Body: {
 *   contactId: "<ghl contact id>",
 *   filename:  "<string, used as source_doc on candidates>",
 *   mime_type: "application/pdf" | "text/csv",
 *   document_base64: "<base64 of the PDF bytes>"   // for PDFs
 *   csv_text:        "<raw CSV text>"              // for CSVs
 * }
 *
 * Response (200): { success, contactId, candidates: [{metric_id, value, period, source_doc, note, confidence}, ...] }
 *
 * Refusals: 401 unauth, 400 bad input / unsupported mime / size cap,
 * 400 not paid_297, 502 malformed Claude output, 503 Claude unavailable.
 *
 * Writes nothing. Strategist accepts or edits in UI; the accept path
 * posts through /case/verified-financials, which runs the §4.2 hash
 * concurrency check and stamps provenance="verified".
 */
export async function handleExtractFinancialsFromDocument(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  if (!contactId) return json({ success: false, error: "contactId required" }, 400);
  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  if (!filename) return json({ success: false, error: "filename required" }, 400);
  const mime = typeof body.mime_type === "string" ? body.mime_type.trim().toLowerCase() : "";
  if (!mime) return json({ success: false, error: "mime_type required" }, 400);

  if (BANNED_MIME_TYPES_WITH_HINTS[mime]) {
    return json({ success: false, error: BANNED_MIME_TYPES_WITH_HINTS[mime] }, 400);
  }
  const kind = SUPPORTED_MIME_TYPES[mime];
  if (!kind) {
    return json({
      success: false,
      error: `unsupported mime_type "${mime}" — supported: ${Object.keys(SUPPORTED_MIME_TYPES).join(", ")}`,
    }, 400);
  }

  let docBase64 = null;
  let csvText = null;
  if (kind === "pdf") {
    docBase64 = typeof body.document_base64 === "string" ? body.document_base64.replace(/\s+/g, "") : "";
    if (!docBase64) {
      return json({ success: false, error: "document_base64 required for PDF uploads" }, 400);
    }
    const size = base64ByteLength(docBase64);
    if (size <= 0) {
      return json({ success: false, error: "document_base64 appears empty" }, 400);
    }
    if (size > MAX_BYTES) {
      return json({
        success: false,
        error: `document too large: ${size} bytes (max ${MAX_BYTES})`,
      }, 400);
    }
  } else if (kind === "csv") {
    csvText = typeof body.csv_text === "string" ? body.csv_text : "";
    if (!csvText.trim()) {
      return json({ success: false, error: "csv_text required for CSV uploads" }, 400);
    }
    const bytes = new TextEncoder().encode(csvText).length;
    if (bytes > MAX_BYTES) {
      return json({
        success: false,
        error: `csv_text too large: ${bytes} bytes (max ${MAX_BYTES})`,
      }, 400);
    }
  }

  const { contact, error } = await fetchGhlContact(contactId, env);
  if (!contact) return json({ success: false, error: error || "contact fetch failed" }, 503);
  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  if (!tags.includes(PAID_297_TAG)) {
    return json({ success: false, error: `contact is not tagged ${PAID_297_TAG}` }, 400);
  }

  const systemText = buildExtractionSystemPrompt();
  const claude = await callClaudeForExtraction({
    systemText, filename, mime, kind, docBase64, csvText, env,
  });
  if (!claude.ok) return json({ success: false, error: claude.error }, claude.status || 503);

  const validated = validateExtractionResponse(claude.text);
  if (!validated.ok) {
    return json({ success: false, error: validated.error }, 502);
  }

  // Attach the uploaded filename as the authoritative source_doc so a
  // strategist viewing the candidate sees the file they actually
  // uploaded, not whatever label Claude guessed.
  const candidates = validated.candidates.map((c) => ({
    ...c,
    source_doc: c.source_doc || filename,
  }));

  return json({
    success: true,
    contactId,
    candidates,
    unverified_notice:
      "These are candidates. Each becomes a verified-financials entry only when the strategist clicks VERIFY or EDIT in the panel.",
  });
}
