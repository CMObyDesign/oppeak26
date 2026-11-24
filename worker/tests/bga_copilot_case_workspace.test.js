// BGA Copilot — case workspace reading (src/bga_copilot/case_workspace.js).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  handleReadDoc,
  handleBuildBase,
  parseReadDocReply,
  parseBuildBaseReply,
  cleanBuildBaseBody,
  buildBaseContent,
  cleanReadDocBody,
} from "../src/bga_copilot/case_workspace.js";
import { isAllowlisted } from "../src/portal_pass.js";

const env = { CONSOLE_PASSWORD: "pw", ANTHROPIC_API_KEY: "k", GHL_API_KEY: "g", GHL_LOCATION_ID: "loc" };
const checkPassword = (r) => r.headers.get("x-console-password") === "pw";
const PDF = { filename: "2025 return.pdf", mime_type: "application/pdf", document_base64: btoa("%PDF-1") };

function req(path, body) {
  return new Request(`https://x${path}`, { method: "POST", headers: { "content-type": "application/json", "x-console-password": "pw" }, body: JSON.stringify(body) });
}
function stub(tags, reply) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/contacts/")) return new Response(JSON.stringify({ contact: { id: "c1", tags, customFields: [] } }), { status: 200 });
    return new Response(JSON.stringify({ content: [{ type: "text", text: reply }], stop_reason: "end_turn" }), { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

const READING = JSON.stringify({
  doc_kind: "tax_return",
  doc_label: "2025 federal return",
  period_covered: "2025",
  prepared_by: "Self-prepared",
  self_prepared: true,
  summary: "Receipts of $535K and $155K owed.",
  key_facts: [{ fact: "Amount owed $155,621", quote: "Amount you owe 155,621" }, { fact: "" }],
  candidates: [
    { metric_id: "revenue_ttm", value: "$535,120", period: "2025", confidence: "high", quote: "Gross receipts 535,120" },
    { metric_id: "revenue_ttm", value: 535120, period: "2025", confidence: "high", quote: "535,120" },
    { metric_id: "tax_status", value: "behind", period: "2025", confidence: "medium", quote: "Amount you owe" },
    { metric_id: "tax_status", value: "owed", period: "2025", quote: "x" },
    { metric_id: "made_up", value: 1, period: "2025", quote: "x" },
    { metric_id: "cash_on_hand", value: 53000, period: "Aug 2026", as_of: "2026-08-06", confidence: "maybe", quote: "Balance 53,000" },
    { metric_id: "net_profit_pct", value: 44, period: "2025" },
    { metric_id: "revenue_ttm", value: 1640000, period: "Year 1", is_projection: true, quote: "Year 1 1,640,000" },
  ],
});

describe("case workspace: read-doc", () => {
  it("is allowed for the portal, POST only", () => {
    for (const p of ["/asksolomon/case/read-doc", "/asksolomon/case/build-base"]) {
      assert.equal(isAllowlisted(p, "POST"), true);
      assert.equal(isAllowlisted(p, "GET"), false);
    }
  });

  it("takes exactly one PDF or CSV", () => {
    assert.match(cleanReadDocBody({ document: PDF }).error, /contactId/);
    assert.match(cleanReadDocBody({ contactId: "c" }).error, /documents required/);
    assert.match(cleanReadDocBody({ contactId: "c", document: { filename: "a.png", mime_type: "image/png" } }).error, /PDF and CSV/);
    assert.equal(cleanReadDocBody({ contactId: "c", document: PDF }).document.kind, "pdf");
  });

  it("reads formatted dollar strings, and drops a figure with no quote", () => {
    const r = parseReadDocReply('{"candidates":[{"metric_id":"revenue_ttm","value":"$1,535,120","period":"2025","quote":"Gross receipts 1,535,120"},{"metric_id":"cash_on_hand","value":5,"period":"x","quote":""}]}');
    assert.deepEqual(r.candidates.map((c) => c.value), [1535120]);
  });

  it("keeps only figures that fit their metric, once each, and marks projections", () => {
    const r = parseReadDocReply("Here: " + READING);
    assert.equal(r.doc_kind, "tax_return");
    assert.equal(r.self_prepared, true);
    assert.equal(r.key_facts.length, 1);
    assert.deepEqual(r.candidates.map((c) => [c.metric_id, c.value, c.is_projection]), [
      ["revenue_ttm", 535120, false],
      ["tax_status", "behind", false],
      ["cash_on_hand", 53000, false],
      ["revenue_ttm", 1640000, true],
    ]);
    assert.equal(r.candidates[2].as_of, "2026-08-06");
    assert.equal(r.candidates[2].confidence, "low");
    assert.equal(parseReadDocReply("nothing"), null);
    assert.equal(parseReadDocReply('{"doc_kind":"weird"}').doc_kind, "other");
  });

  it("refuses non-BGA contacts and reads a BGA document", async () => {
    let s = stub(["swot_paid_47"], READING);
    try {
      const res = await handleReadDoc(req("/asksolomon/case/read-doc", { contactId: "c1", document: PDF }), env, { checkPassword });
      assert.equal(res.status, 400);
    } finally { s.restore(); }
    s = stub(["bga_staff_case"], READING);
    try {
      const res = await handleReadDoc(req("/asksolomon/case/read-doc", { contactId: "c1", document: PDF }), env, { checkPassword });
      const j = await res.json();
      assert.equal(res.status, 200);
      assert.equal(j.filename, "2025 return.pdf");
      assert.equal(j.candidates.length, 4);
      const sent = JSON.parse(s.calls.find((c) => c.url.includes("anthropic")).init.body);
      assert.equal(sent.stream, true);
      assert.ok(sent.messages[0].content.some((b) => b.type === "document"));
      // Never writes to HighLevel.
      assert.ok(!s.calls.some((c) => c.url.includes("/contacts/") && c.init?.method && c.init.method !== "GET"));
    } finally { s.restore(); }
  });
});

const BODY = {
  contactId: "c1",
  contact_name: "Tye Jefferson",
  documents: [
    { filename: "2025 return.pdf", doc_label: "2025 federal return", summary: "Owes tax.", key_facts: [{ fact: "Owes $155K" }] },
    { filename: "Bill of sale.pdf", doc_label: "Bill of sale", summary: "Printer bought for $526K." },
    { filename: "Bill of sale copy.pdf", doc_label: "Bill of sale" },
  ],
  candidates: [{ metric_id: "revenue_ttm", value: 535120, period: "2025", source: "2025 return.pdf" }],
  notes: [{ text: "Wants a loan against the equipment.", by: "Liz", at: "Nov 23" }],
  confirmed: [{ key: "owner", question: "Who owns it?", answer: "Brandon, 100%" }],
};

describe("case workspace: build-base", () => {
  it("needs readings and sends every one, with notes and confirmed facts", () => {
    assert.match(cleanBuildBaseBody({ contactId: "c1" }).error, /Read the documents/);
    const text = buildBaseContent(cleanBuildBaseBody(BODY));
    for (const s of ["### 2025 return.pdf", "### Bill of sale.pdf", "### Bill of sale copy.pdf", "revenue_ttm · 535120", "Liz, Nov 23", "owner: Who owns it? → Brandon, 100%", "Tye Jefferson"]) assert.ok(text.includes(s), s);
  });

  it("drops sources that aren't real files or notes, and always has goal, challenge, owner first", () => {
    const clean = cleanBuildBaseBody(BODY);
    const out = parseBuildBaseReply(JSON.stringify({
      story: { headline: "A consultant became a manufacturer.", steps: [{ when: "2025", what: "Bought a printer.", source: "Bill of sale.pdf" }, { when: "2026", what: "Says revenue doubled.", source: "invented.pdf" }, { when: "", what: "x" }] },
      facts: [
        { key: "wolf", question: "Who is Michael Wolf?", suggested: "A partner", source: "nowhere.pdf" },
        { key: "goal", question: "The goal", suggested: "A loan against the equipment.", source: "Team note" },
        { key: "cost", question: "What did the printer cost?", suggested: "$526K", source: "Bill of sale.pdf" },
        { key: "cost", question: "dupe", suggested: "x", source: "Bill of sale.pdf" },
      ],
      warnings: [{ title: "Contact mismatch", text: "Record says Tye, documents say Brandon." }, { title: "", text: "x" }],
      number_flags: { revenue_ttm: "Two 2025 figures 12x apart.", nope: "x" },
      duplicates: [["Bill of sale.pdf", "Bill of sale copy.pdf"], ["Bill of sale.pdf", "ghost.pdf"]],
    }), clean);
    assert.deepEqual(out.facts.slice(0, 3).map((f) => f.key), ["goal", "challenge", "owner"]);
    assert.equal(out.facts[0].source, "Team note");
    assert.equal(out.facts[1].suggested, "");
    const wolf = out.facts.find((f) => f.key === "wolf");
    assert.deepEqual([wolf.suggested, wolf.source], ["", ""]); // ungrounded → open question
    assert.equal(out.facts.filter((f) => f.key === "cost").length, 1);
    // A fact staff confirmed keeps its answer even though the model gave it no document source.
    const owner = out.facts.find((f) => f.key === "owner");
    assert.deepEqual([owner.suggested, owner.source], ["Brandon, 100%", "Confirmed by staff"]);
    assert.deepEqual(out.story.steps.map((s) => s.source), ["Bill of sale.pdf", ""]);
    assert.equal(out.warnings.length, 1);
    assert.deepEqual(Object.keys(out.number_flags), ["revenue_ttm"]);
    assert.deepEqual(out.duplicates, [["Bill of sale.pdf", "Bill of sale copy.pdf"]]);
  });

  it("a team note can't be a source when there are no notes", () => {
    const clean = cleanBuildBaseBody({ ...BODY, notes: [] });
    const out = parseBuildBaseReply('{"facts":[{"key":"goal","question":"The goal","suggested":"Grow","source":"Team note"}]}', clean);
    assert.equal(out.facts[0].suggested, "");
  });

  it("runs end to end for a BGA case", async () => {
    const s = stub(["bga_staff_case"], '{"story":{"headline":"H","steps":[]},"facts":[],"warnings":[]}');
    try {
      const res = await handleBuildBase(req("/asksolomon/case/build-base", BODY), env, { checkPassword });
      const j = await res.json();
      assert.equal(res.status, 200);
      assert.equal(j.documents_read, 3);
      assert.equal(j.facts.length, 3);
    } finally { s.restore(); }
  });
});
