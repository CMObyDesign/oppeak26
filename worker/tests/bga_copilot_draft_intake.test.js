// BGA Copilot — draft the intake from documents (src/bga_copilot/draft_intake.js).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { handleDraftIntake, cleanDraftIntakeBody, parseDraftIntakeReply, buildDraftIntakeContent } from "../src/bga_copilot/draft_intake.js";
import { isAllowlisted } from "../src/portal_pass.js";

const env = { CONSOLE_PASSWORD: "pw", ANTHROPIC_API_KEY: "k", GHL_API_KEY: "g", GHL_LOCATION_ID: "loc" };
const checkPassword = (r) => r.headers.get("x-console-password") === "pw";
const Q = [{ key: "Q_D", label: "Cash position" }, { key: "Q_M", label: "Three-year vision" }];
const DOCS = [{ filename: "bank.pdf", mime_type: "application/pdf", document_base64: btoa("%PDF-1") }, { filename: "pl.csv", mime_type: "text/csv", csv_text: "a,b\n1,2" }];

function req(body) {
  return new Request("https://x/asksolomon/case/draft-intake", { method: "POST", headers: { "content-type": "application/json", "x-console-password": "pw" }, body: JSON.stringify(body) });
}
function stub(tags, reply) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/contacts/")) return new Response(JSON.stringify({ contact: { id: "c1", tags, customFields: [] } }), { status: 200 });
    return new Response(JSON.stringify({ content: [{ type: "text", text: reply }] }), { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

describe("draft-intake", () => {
  it("is allowed for the portal, POST only", () => {
    assert.equal(isAllowlisted("/asksolomon/case/draft-intake", "POST"), true);
    assert.equal(isAllowlisted("/asksolomon/case/draft-intake", "GET"), false);
  });

  it("validates the body: questions, documents, types, count", () => {
    assert.match(cleanDraftIntakeBody({ questions: Q, documents: DOCS }).error, /contactId/);
    assert.match(cleanDraftIntakeBody({ contactId: "c", documents: DOCS }).error, /questions/);
    assert.match(cleanDraftIntakeBody({ contactId: "c", questions: Q, documents: [] }).error, /documents/);
    assert.match(cleanDraftIntakeBody({ contactId: "c", questions: Q, documents: [{ filename: "x.png", mime_type: "image/png" }] }).error, /PDF and CSV/);
    assert.match(cleanDraftIntakeBody({ contactId: "c", questions: Q, documents: Array(9).fill(DOCS[1]) }).error, /At most 8/);
    assert.equal(cleanDraftIntakeBody({ contactId: "c", questions: Q, documents: DOCS }).documents.length, 2);
  });

  it("sends PDFs as document blocks and CSVs as text, then the questions", () => {
    const c = buildDraftIntakeContent(Q, cleanDraftIntakeBody({ contactId: "c", questions: Q, documents: DOCS }).documents);
    assert.equal(c.find((b) => b.type === "document").source.media_type, "application/pdf");
    assert.ok(c.some((b) => b.type === "text" && b.text.includes("<csv")));
    assert.ok(c[c.length - 1].text.includes("Q_M: Three-year vision"));
  });

  it("parses the reply: every question once, unknown sources dropped, empty when not supported", () => {
    const docs = [{ filename: "bank.pdf" }];
    const out = parseDraftIntakeReply('Sure: {"answers":[{"key":"Q_D","answer":"About $42K in checking.","sources":["bank.pdf","made-up.pdf"],"confidence":"high"},{"key":"ZZ","answer":"x"}],"notes":"Bank only."}', Q, docs);
    assert.deepEqual(out.answers, [
      { key: "Q_D", answer: "About $42K in checking.", sources: ["bank.pdf"], confidence: "high" },
      { key: "Q_M", answer: "", sources: [], confidence: null },
    ]);
    assert.equal(out.notes, "Bank only.");
    // No validated source: the answer is dropped.
    const ungrounded = parseDraftIntakeReply('{"answers":[{"key":"Q_D","answer":"Lots of cash.","sources":["invented.pdf"],"confidence":"high"},{"key":"Q_M","answer":"Grow.","confidence":"low"}]}', Q, docs);
    assert.deepEqual(ungrounded.answers.map((a) => [a.answer, a.confidence]), [["", null], ["", null]]);
    assert.equal(parseDraftIntakeReply("no json here", Q, docs), null);
  });

  it("works for a staff-started BGA and never writes to HighLevel", async () => {
    const { calls, restore } = stub(["bga_staff_case"], '{"answers":[{"key":"Q_D","answer":"Cash is tight.","sources":["bank.pdf"],"confidence":"medium"}],"notes":""}');
    try {
      const res = await handleDraftIntake(req({ contactId: "c1", questions: Q, documents: DOCS }), env, { checkPassword });
      assert.equal(res.status, 200);
      const j = await res.json();
      assert.equal(j.answers[0].answer, "Cash is tight.");
      assert.deepEqual(j.documents_read, ["bank.pdf", "pl.csv"]);
      assert.ok(calls.every((c) => !c.init || !["PUT", "DELETE"].includes(c.init.method)));
      assert.ok(!calls.some((c) => c.url.includes("/tags")));
    } finally { restore(); }
  });

  it("refuses a contact without a BGA case", async () => {
    const { restore } = stub(["swot_paid_47"], "{}");
    try {
      const res = await handleDraftIntake(req({ contactId: "c1", questions: Q, documents: DOCS }), env, { checkPassword });
      assert.equal(res.status, 400);
    } finally { restore(); }
  });
});
