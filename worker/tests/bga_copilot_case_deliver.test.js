// BGA Copilot — case workspace Review and deliver (src/bga_copilot/case_deliver.js).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { handleWorkspaceRedteam, handleWorkspacePrep, parseRedteamReply, parsePrepReply, cleanRoadmap } from "../src/bga_copilot/case_deliver.js";
import { isAllowlisted } from "../src/portal_pass.js";

const env = { CONSOLE_PASSWORD: "pw", ANTHROPIC_API_KEY: "k", GHL_API_KEY: "g", GHL_LOCATION_ID: "loc" };
const checkPassword = (r) => r.headers.get("x-console-password") === "pw";
const ROADMAP = {
  findings: [{ kind: "threat", vital_sign: "Money", text: "Tax owed", evidence: "Returns", source: "2025 return.pdf", unconfirmed: false }],
  path: [{ when: "Now to day 90", what: "A file a lender can rely on." }],
  actions: [{ id: "A1", what: "Pull transcripts", owner: "Accounting", due: "Week 1", number: "Tax owed", start: "unconfirmed", target: "on a plan" }],
  client_view: { title: "Your path", intro: "You own a paid-off asset.", steps: ["CPA statements."], closing: "We'll track profit." },
};
const BODY = { contactId: "c1", goal: "A loan against the equipment.", roadmap: ROADMAP, documents: [{ filename: "2025 return.pdf", label: "Return", summary: "Owes tax." }] };

function stub(reply) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/contacts/")) return new Response(JSON.stringify({ contact: { id: "c1", tags: ["bga_staff_case"], customFields: [] } }), { status: 200 });
    return new Response(JSON.stringify({ content: [{ type: "text", text: reply }], stop_reason: "end_turn" }), { status: 200 });
  };
  return { calls, restore: () => (globalThis.fetch = orig) };
}
const req = (path, body) => new Request(`https://x${path}`, { method: "POST", headers: { "x-console-password": "pw", "content-type": "application/json" }, body: JSON.stringify(body) });

describe("case workspace: review and deliver", () => {
  it("is allowed for the portal, POST only", () => {
    for (const p of ["/asksolomon/case/workspace-redteam", "/asksolomon/case/workspace-prep"]) {
      assert.equal(isAllowlisted(p, "POST"), true);
      assert.equal(isAllowlisted(p, "GET"), false);
    }
  });

  it("red team: keeps known severities and places, redacts, caps at 12", () => {
    const out = parseRedteamReply(JSON.stringify({
      issues: [
        { severity: "must_fix", where: "a1", problem: "Account 12345678901 is in the action.", fix: "Remove it." },
        { severity: "should_fix", where: "client view", problem: "Jargon.", fix: "Plain words." },
        { severity: "nit", where: "A1", problem: "x" },
        { severity: "must_fix", where: "somewhere", problem: "Vague place.", fix: "" },
      ],
      summary: "Not ready.",
    }));
    assert.deepEqual(out.issues.map((i) => [i.severity, i.where]), [["must_fix", "A1"], ["should_fix", "Client view"], ["must_fix", "Overall"]]);
    assert.ok(!out.issues[0].problem.includes("12345678901"));
    assert.equal(parseRedteamReply("nope"), null);
  });

  it("prep: needs an opening and an agenda; minutes are bounded", () => {
    assert.equal(parsePrepReply('{"opening":"","agenda":[]}'), null);
    const p = parsePrepReply(JSON.stringify({ opening: "We read everything.", agenda: [{ topic: "Taxes", minutes: 90, goal: "Agree the plan" }, { topic: "", minutes: 5 }], ask: ["Who is Michael Wolf?", ""], decide: ["Which lender first"], watch: ["Related-party signatures"] }));
    assert.deepEqual(p.agenda, [{ topic: "Taxes", minutes: 30, goal: "Agree the plan" }]);
    assert.deepEqual(p.ask, ["Who is Michael Wolf?"]);
  });

  it("needs a drafted roadmap and a confirmed goal", async () => {
    const s = stub("{}");
    try {
      let res = await handleWorkspaceRedteam(req("/asksolomon/case/workspace-redteam", { ...BODY, roadmap: {} }), env, { checkPassword });
      assert.equal(res.status, 400);
      res = await handleWorkspacePrep(req("/asksolomon/case/workspace-prep", { ...BODY, goal: "" }), env, { checkPassword });
      assert.equal(res.status, 400);
    } finally {
      s.restore();
    }
  });

  it("sends the sources and the roadmap, end to end", async () => {
    const s = stub(JSON.stringify({ issues: [{ severity: "must_fix", where: "A1", problem: "No source.", fix: "Confirm it." }], summary: "Fix A1." }));
    try {
      const res = await handleWorkspaceRedteam(req("/asksolomon/case/workspace-redteam", BODY), env, { checkPassword });
      const j = await res.json();
      assert.equal(res.status, 200);
      assert.equal(j.issues[0].where, "A1");
      const sent = JSON.parse(s.calls.find((c) => c.url.includes("anthropic")).init.body).messages[0].content;
      assert.ok(sent.includes("THE GOAL (confirmed): A loan"));
      assert.ok(sent.includes("A1: Pull transcripts · owner Accounting · Week 1"));
      assert.ok(sent.includes("Client view intro: You own a paid-off asset."));
      assert.ok(sent.trim().endsWith("Answer as JSON only."));
    } finally {
      s.restore();
    }
  });

  it("cleans a stored roadmap", () => {
    const r = cleanRoadmap({ actions: [{ id: "A1", what: "x" }, { what: "no id" }], client_view: { steps: ["a", 3, ""] } });
    assert.equal(r.actions.length, 1);
    assert.deepEqual(r.client_view.steps, ["a"]);
  });
});
