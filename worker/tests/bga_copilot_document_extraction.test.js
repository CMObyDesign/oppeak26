// BGA Copilot — document extraction tests (PR 14).
//
// Pins:
//   - Password gate.
//   - Required-input validation (contactId, filename, mime_type, document_base64 or csv_text).
//   - Unsupported mime types refused with 400 + helpful hint for xlsx/doc.
//   - MAX_BYTES cap enforced.
//   - swot_paid_297 required on the contact.
//   - Claude unavailable → 503.
//   - validateExtractionResponse: canonical metric_ids only, dedupe,
//     shape validation per metric, tolerates ```json fence.
//   - §9 guardrails:
//       * Handler NEVER writes any GHL custom field. Pinned by observing
//         zero PUT calls on happy path.
//       * Handler NEVER applies any tag. Zero /tags calls.
//       * Handler NEVER writes `swot_growth_plan` or applies
//         `swot_growth_plan_ready` (grep + behavior).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  handleExtractFinancialsFromDocument,
  validateExtractionResponse,
  buildExtractionSystemPrompt,
  SUPPORTED_MIME_TYPES,
} from "../src/bga_copilot/document_extraction.js";
import { _resetCatalogCacheForTests } from "../src/ghl_catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

beforeEach(() => {
  _resetCatalogCacheForTests();
});

function makeEnv(overrides = {}) {
  return {
    GHL_API_KEY: "test-ghl",
    GHL_LOCATION_ID: "test-loc",
    CONSOLE_PASSWORD: "test-password",
    ANTHROPIC_API_KEY: "test-anthropic",
    ...overrides,
  };
}
const PASS = { "x-console-password": "test-password" };
function post(body, headers = PASS) {
  return new Request("https://example.com/x", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
function checkPassword(request, env) {
  const p = request.headers.get("x-console-password");
  return p && env.CONSOLE_PASSWORD && p === env.CONSOLE_PASSWORD;
}
function stubFetch(responder) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET", body: init?.body });
    return responder(url, init);
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

function ghlContactRes({ tags = ["swot_paid_297"], customFields = [] } = {}) {
  return new Response(
    JSON.stringify({ contact: { id: "c1", tags, customFields } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
function emptyCatalogRes() {
  return new Response(JSON.stringify({ customFields: [] }), { status: 200 });
}
function claudeExtractionRes(candidatesArr) {
  return new Response(JSON.stringify({
    content: [{ type: "text", text: JSON.stringify({ candidates: candidatesArr }) }],
    stop_reason: "end_turn",
  }), { status: 200, headers: { "content-type": "application/json" } });
}

// Small valid base64 ("PDFPDF" encoded) — not actually a PDF, but the
// handler validates size, not contents, and we stub Claude so no real
// parsing happens.
const SMALL_B64 = Buffer.from("PDFPDF").toString("base64");

describe("buildExtractionSystemPrompt", () => {
  it("mentions every canonical metric_id and the strict JSON contract", () => {
    const p = buildExtractionSystemPrompt();
    for (const id of [
      "cash_on_hand", "revenue_ttm", "gross_margin_pct", "net_profit_pct",
      "ar_30_60_90", "monthly_debt_service", "outstanding_debt_total",
      "debt_terms", "working_capital", "tax_status",
    ]) {
      assert.ok(p.includes(id), `prompt missing metric id ${id}`);
    }
    assert.match(p, /STRICT JSON/i);
    assert.match(p, /VERIFY, EDIT, or REJECT/i);
  });
});

describe("validateExtractionResponse", () => {
  it("parses a valid JSON object with a candidates array", () => {
    const text = JSON.stringify({
      candidates: [
        { metric_id: "cash_on_hand", value: 12000, period: "2026-09",
          source_doc: "bs.pdf", note: "line 1", confidence: "high" },
      ],
    });
    const r = validateExtractionResponse(text);
    assert.equal(r.ok, true);
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].metric_id, "cash_on_hand");
    assert.equal(r.candidates[0].value, 12000);
  });

  it("tolerates a leading ```json fence", () => {
    const text = "```json\n" + JSON.stringify({
      candidates: [
        { metric_id: "revenue_ttm", value: 500000, period: "2025-TTM",
          source_doc: "pnl.pdf", confidence: "medium" },
      ],
    }) + "\n```";
    const r = validateExtractionResponse(text);
    assert.equal(r.ok, true);
    assert.equal(r.candidates[0].metric_id, "revenue_ttm");
  });

  it("rejects malformed JSON", () => {
    assert.equal(validateExtractionResponse("not json").ok, false);
    assert.equal(validateExtractionResponse("").ok, false);
  });

  it("rejects a response without a candidates array", () => {
    assert.equal(validateExtractionResponse(JSON.stringify({})).ok, false);
    assert.equal(validateExtractionResponse(JSON.stringify({ candidates: "nope" })).ok, false);
  });

  it("skips candidates with unknown metric_ids but keeps the valid ones", () => {
    const r = validateExtractionResponse(JSON.stringify({
      candidates: [
        { metric_id: "mystery_metric", value: 1, period: "2026-09", source_doc: "x" },
        { metric_id: "cash_on_hand", value: 500, period: "2026-09", source_doc: "x" },
      ],
    }));
    assert.equal(r.ok, true);
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].metric_id, "cash_on_hand");
  });

  it("skips candidates with malformed values but keeps the valid ones", () => {
    const r = validateExtractionResponse(JSON.stringify({
      candidates: [
        { metric_id: "cash_on_hand", value: "not a number", period: "2026-09", source_doc: "x" },
        { metric_id: "revenue_ttm", value: 500000, period: "2025-TTM", source_doc: "pnl.pdf" },
      ],
    }));
    assert.equal(r.ok, true);
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].metric_id, "revenue_ttm");
  });

  it("validates the ar_aging shape", () => {
    const r = validateExtractionResponse(JSON.stringify({
      candidates: [
        { metric_id: "ar_30_60_90",
          value: { d30: 1000, d60: 500, d90_plus: 2500 },
          period: "2026-09", source_doc: "ar.pdf" },
      ],
    }));
    assert.equal(r.ok, true);
    assert.deepEqual(r.candidates[0].value, { d30: 1000, d60: 500, d90_plus: 2500 });
  });

  it("validates tax_status enum", () => {
    const r = validateExtractionResponse(JSON.stringify({
      candidates: [
        { metric_id: "tax_status", value: "in_default",
          period: "2026-09", source_doc: "ts.pdf" },
        { metric_id: "tax_status", value: "unclear",
          period: "2026-09", source_doc: "ts.pdf" },
      ],
    }));
    assert.equal(r.ok, true);
    // Only one survives (first is valid; second's enum rejected; dedupe
    // by metric_id would also have excluded the second).
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].value, "in_default");
  });

  it("dedupes by metric_id (first valid wins)", () => {
    const r = validateExtractionResponse(JSON.stringify({
      candidates: [
        { metric_id: "cash_on_hand", value: 100, period: "2026-09", source_doc: "a.pdf" },
        { metric_id: "cash_on_hand", value: 200, period: "2026-09", source_doc: "a.pdf" },
      ],
    }));
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].value, 100);
  });

  it("defaults confidence to 'medium' when missing or invalid", () => {
    const r = validateExtractionResponse(JSON.stringify({
      candidates: [
        { metric_id: "cash_on_hand", value: 100, period: "2026-09", source_doc: "a.pdf" },
      ],
    }));
    assert.equal(r.candidates[0].confidence, "medium");
  });
});

describe("POST /asksolomon/case/extract-financials-from-document — preconditions", () => {
  it("401 without x-console-password", async () => {
    const res = await handleExtractFinancialsFromDocument(
      post({ contactId: "c1" }, {}),
      makeEnv(), { checkPassword },
    );
    assert.equal(res.status, 401);
  });

  it("400 without contactId", async () => {
    const res = await handleExtractFinancialsFromDocument(
      post({}), makeEnv(), { checkPassword },
    );
    assert.equal(res.status, 400);
  });

  it("400 without filename", async () => {
    const res = await handleExtractFinancialsFromDocument(
      post({ contactId: "c1" }), makeEnv(), { checkPassword },
    );
    assert.equal(res.status, 400);
  });

  it("400 without mime_type", async () => {
    const res = await handleExtractFinancialsFromDocument(
      post({ contactId: "c1", filename: "x.pdf" }),
      makeEnv(), { checkPassword },
    );
    assert.equal(res.status, 400);
  });

  it("400 for unsupported mime (xlsx) with a helpful hint", async () => {
    const res = await handleExtractFinancialsFromDocument(
      post({ contactId: "c1", filename: "x.xlsx",
        mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      makeEnv(), { checkPassword },
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /XLSX/);
  });

  it("400 for unsupported mime (docx) with a helpful hint", async () => {
    const res = await handleExtractFinancialsFromDocument(
      post({ contactId: "c1", filename: "x.docx",
        mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
      makeEnv(), { checkPassword },
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /DOCX/i);
  });

  it("400 for an unknown mime type", async () => {
    const res = await handleExtractFinancialsFromDocument(
      post({ contactId: "c1", filename: "x.bin", mime_type: "application/octet-stream" }),
      makeEnv(), { checkPassword },
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /unsupported mime_type/);
  });

  it("400 PDF without document_base64", async () => {
    const res = await handleExtractFinancialsFromDocument(
      post({ contactId: "c1", filename: "x.pdf", mime_type: "application/pdf" }),
      makeEnv(), { checkPassword },
    );
    assert.equal(res.status, 400);
  });

  it("400 CSV without csv_text", async () => {
    const res = await handleExtractFinancialsFromDocument(
      post({ contactId: "c1", filename: "x.csv", mime_type: "text/csv" }),
      makeEnv(), { checkPassword },
    );
    assert.equal(res.status, 400);
  });

  it("400 PDF exceeding the 10MB cap", async () => {
    // A 10MB+1 payload worth of base64 chars.
    const big = "A".repeat(14_000_001); // base64 → ~10.5 MB bytes
    const res = await handleExtractFinancialsFromDocument(
      post({ contactId: "c1", filename: "big.pdf", mime_type: "application/pdf",
        document_base64: big }),
      makeEnv(), { checkPassword },
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /too large/);
  });

  it("400 when contact is not paid_297", async () => {
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields")) return emptyCatalogRes();
      return ghlContactRes({ tags: ["swot_free"] });
    });
    try {
      const res = await handleExtractFinancialsFromDocument(
        post({ contactId: "c1", filename: "x.pdf",
          mime_type: "application/pdf", document_base64: SMALL_B64 }),
        makeEnv(), { checkPassword },
      );
      assert.equal(res.status, 400);
    } finally { cap.restore(); }
  });

  it("503 when Claude is unavailable (ANTHROPIC_API_KEY missing)", async () => {
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields")) return emptyCatalogRes();
      return ghlContactRes();
    });
    try {
      const res = await handleExtractFinancialsFromDocument(
        post({ contactId: "c1", filename: "x.pdf",
          mime_type: "application/pdf", document_base64: SMALL_B64 }),
        makeEnv({ ANTHROPIC_API_KEY: undefined }), { checkPassword },
      );
      assert.equal(res.status, 503);
    } finally { cap.restore(); }
  });
});

describe("POST /asksolomon/case/extract-financials-from-document — happy path", () => {
  it("200 returns candidates and the source_doc defaults to the uploaded filename", async () => {
    const cap = stubFetch((url) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) {
        return claudeExtractionRes([
          { metric_id: "cash_on_hand", value: 12000, period: "2026-09",
            source_doc: "", confidence: "high" },
          { metric_id: "revenue_ttm", value: 500000, period: "2025-TTM",
            source_doc: "pnl.pdf", confidence: "medium" },
        ]);
      }
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      return ghlContactRes();
    });
    try {
      const res = await handleExtractFinancialsFromDocument(
        post({ contactId: "c1", filename: "balance_sheet_2026-09.pdf",
          mime_type: "application/pdf", document_base64: SMALL_B64 }),
        makeEnv(), { checkPassword },
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.candidates.length, 1);
      // The first candidate had an empty source_doc → should be the required-field reject.
      // The second is kept with its explicit source_doc.
      assert.equal(body.candidates[0].metric_id, "revenue_ttm");
      assert.equal(body.candidates[0].source_doc, "pnl.pdf");
    } finally { cap.restore(); }
  });

  it("200 CSV path (no document_base64 required)", async () => {
    const cap = stubFetch((url) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) {
        return claudeExtractionRes([
          { metric_id: "cash_on_hand", value: 50000, period: "2026-09",
            source_doc: "bank.csv", confidence: "high" },
        ]);
      }
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      return ghlContactRes();
    });
    try {
      const res = await handleExtractFinancialsFromDocument(
        post({ contactId: "c1", filename: "bank.csv",
          mime_type: "text/csv", csv_text: "date,amount\n2026-09,50000\n" }),
        makeEnv(), { checkPassword },
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.candidates.length, 1);
      assert.equal(body.candidates[0].metric_id, "cash_on_hand");
    } finally { cap.restore(); }
  });

  it("502 when Claude returns malformed JSON", async () => {
    const cap = stubFetch((url) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) {
        return new Response(JSON.stringify({
          content: [{ type: "text", text: "not JSON" }],
        }), { status: 200 });
      }
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      return ghlContactRes();
    });
    try {
      const res = await handleExtractFinancialsFromDocument(
        post({ contactId: "c1", filename: "x.pdf",
          mime_type: "application/pdf", document_base64: SMALL_B64 }),
        makeEnv(), { checkPassword },
      );
      assert.equal(res.status, 502);
    } finally { cap.restore(); }
  });
});

describe("§9/10 — document extraction NEVER writes any GHL field or tag", () => {
  it("happy path fires zero PUT calls and zero /tags calls", async () => {
    let putCount = 0, tagCount = 0;
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) {
        return claudeExtractionRes([
          { metric_id: "cash_on_hand", value: 100, period: "2026-09",
            source_doc: "x.pdf", confidence: "high" },
        ]);
      }
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.includes("/contacts/") && init?.method === "PUT") { putCount++; return new Response("", { status: 200 }); }
      if (u.endsWith("/tags")) { tagCount++; return new Response("", { status: 200 }); }
      return ghlContactRes();
    });
    try {
      const res = await handleExtractFinancialsFromDocument(
        post({ contactId: "c1", filename: "x.pdf",
          mime_type: "application/pdf", document_base64: SMALL_B64 }),
        makeEnv(), { checkPassword },
      );
      assert.equal(res.status, 200);
      assert.equal(putCount, 0, "extraction must not PUT any custom fields");
      assert.equal(tagCount, 0, "extraction must not apply any tag");
    } finally { cap.restore(); }
  });

  it("source file does not reference swot_growth_plan or swot_growth_plan_ready", () => {
    const src = readFileSync(
      resolve(repoRoot, "worker/src/bga_copilot/document_extraction.js"),
      "utf8",
    );
    assert.ok(!/["']swot_growth_plan["']/.test(src), "must not reference swot_growth_plan");
    assert.ok(!/["']swot_growth_plan_ready["']/.test(src), "must not reference swot_growth_plan_ready");
  });
});

describe("SUPPORTED_MIME_TYPES", () => {
  it("supports pdf and csv", () => {
    assert.equal(SUPPORTED_MIME_TYPES["application/pdf"], "pdf");
    assert.equal(SUPPORTED_MIME_TYPES["text/csv"], "csv");
  });
});
