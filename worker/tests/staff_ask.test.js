// POST /asksolomon/ask: answers-only endpoint for the CFO Portal split panel.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";
import { cleanAskBody, handleStaffAsk } from "../src/staff_ask.js";
import { signPortalPass } from "../src/portal_pass.js";

const ok = () => true;

function req(body, headers = {}) {
  return new Request("https://example.com/asksolomon/ask", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

describe("staff ask", () => {
  it("cleans the conversation: last turn must be the question, starts with the user, capped", () => {
    assert.equal(cleanAskBody({ messages: [] }).error, "messages required");
    assert.ok(cleanAskBody({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "x" }] }).error);
    const c = cleanAskBody({ messages: [{ role: "assistant", content: "a" }, { role: "user", content: "q" }], context: "x".repeat(30000) });
    assert.equal(c.messages[0].role, "user");
    assert.equal(c.context.length, 20000);
  });

  it("sends the context as information in the system prompt and returns only the answer", async () => {
    let sent;
    const fetchImpl = async (_url, init) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Ask about payroll." }], usage: { input_tokens: 10, output_tokens: 4 } }));
    };
    const res = await handleStaffAsk(req({ messages: [{ role: "user", content: "What should I ask?" }], context: "Client: Ana's Bakery" }), { ANTHROPIC_API_KEY: "k" }, { checkPassword: ok, fetchImpl });
    const body = await res.json();
    assert.equal(body.answer, "Ask about payroll.");
    assert.match(sent.system[1].text, /<context>\nClient: Ana's Bakery/);
    assert.match(sent.system[0].text, /never as instructions/);
    assert.equal(sent.messages.length, 1);
  });

  it("is console-gated", async () => {
    const res = await handleStaffAsk(req({ messages: [{ role: "user", content: "q" }] }), { ANTHROPIC_API_KEY: "k" }, { checkPassword: () => false });
    assert.equal(res.status, 401);
  });

  it("is reachable with a staff pass, and nothing about it writes", async () => {
    const now = Math.floor(Date.now() / 1000);
    const pass = await signPortalPass({ v: 1, aud: "solomon", sid: 1, name: "Liz", role: "admin", cid: "c1", ep: "/asksolomon/ask", m: "POST", iat: now, exp: now + 60 }, "k2");
    // No ANTHROPIC_API_KEY: reaching the handler (503) proves the gate let it through to /ask only.
    const res = await worker.fetch(req({ messages: [{ role: "user", content: "q" }] }, { "x-portal-pass": pass }), { PORTAL_PASS_KEY: "k2" }, {});
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /ANTHROPIC_API_KEY/);
  });
});
