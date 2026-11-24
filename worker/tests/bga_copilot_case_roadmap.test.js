// BGA Copilot — case workspace roadmap (src/bga_copilot/case_roadmap.js).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { handleWorkspaceRoadmap, cleanRoadmapBody, buildRoadmapContent, parseRoadmapReply, redact } from "../src/bga_copilot/case_roadmap.js";
import { _setCatalogForTests } from "../src/bga_copilot/services_catalog.js";
import { isAllowlisted } from "../src/portal_pass.js";

const env = { CONSOLE_PASSWORD: "pw", ANTHROPIC_API_KEY: "k", GHL_API_KEY: "g", GHL_LOCATION_ID: "loc" };
const checkPassword = (r) => r.headers.get("x-console-password") === "pw";
const CATALOG = [{ service_id: "accounting_tax", name: "Accounting & Tax", problem_solved: "Books and returns.", pricing: { amount_usd: 999 } }, { service_id: "capital", name: "Business Capital", problem_solved: "Funding." }];

const BODY = {
  contactId: "c1",
  goal: "A loan against the paid-off equipment, plus a line of credit.",
  confirmed: [{ question: "Who owns the business?", answer: "Brandon, 100%." }],
  numbers: [{ name: "Revenue", value: "$535K", period: "2025", source: "2025 return.pdf" }],
  unconfirmed: [{ question: "Is the waiting list signed?", suggested: "", source: "" }],
  documents: [{ filename: "2025 return.pdf", label: "2025 federal return", summary: "Owes $155K.", self_prepared: true }],
  notes: [{ text: "Doesn't know his numbers per project.", by: "Liz" }],
  warnings: [{ title: "Contact mismatch", text: "Tye vs Brandon." }],
  story: { headline: "A consultant became a manufacturer.", steps: [{ when: "2025", what: "Bought a printer.", source: "Bill of sale.pdf" }] },
};

const REPLY = {
  findings: [
    { kind: "threat", vital_sign: "Money", text: "About $310K in tax owed", evidence: "Two returns", source: "2025 return.pdf", quote: "Amount you owe 155,621", feeds: "A2" },
    { kind: "weak_spot", vital_sign: "Money", text: "No profit per project", evidence: "Team note", source: "Team note", feeds: "A9" },
    { kind: "opportunity", vital_sign: "Customers", text: "Waiting list", evidence: "Owner says so", source: "invented.pdf", feeds: "6 months" },
    { kind: "strength", vital_sign: "Money", text: "Revenue held steady", evidence: "Return", source: "Verified: Revenue", feeds: "6 months" },
    { kind: "nope", vital_sign: "Money", text: "x", source: "Team note" },
  ],
  path: [{ when: "Now to day 90", what: "A file a lender can rely on." }, { when: "", what: "x" }],
  actions: [
    { id: "A1", what: "Set up profit tracking by project", vital_sign: "Operations", from_finding: "No profit per project", owner: "Accounting", due: "Week 8", number: "Open jobs with a profit number", start: "0", target: "all", service_id: "accounting_tax" },
    { id: "A2", what: "Pull IRS transcripts, EIN 12-3456789, acct 123456789012", vital_sign: "Money", from_finding: "Tax owed", owner: "Accounting", due: "Week 1", number: "Tax owed", start: "unconfirmed", target: "on a plan", service_id: "made_up" },
    { id: "A3", what: "Call lenders", vital_sign: "Money", owner: "Advisor", due: "Soon", number: "Term sheets", start: "0", target: "1" },
    { id: "A4", what: "Something", vital_sign: "Money", owner: "Advisor", due: "Week 3", number: "", start: "", target: "" },
  ],
  client_view: { title: "Your path to equipment financing", intro: "You own a paid-off asset.", steps: ["CPA statements.", ""], closing: "We'll track profit per project." },
};

describe("case workspace roadmap", () => {
  it("is allowed for the portal, POST only", () => {
    assert.equal(isAllowlisted("/asksolomon/case/workspace-roadmap", "POST"), true);
    assert.equal(isAllowlisted("/asksolomon/case/workspace-roadmap", "GET"), false);
  });

  it("needs a confirmed goal", () => {
    assert.match(cleanRoadmapBody({ contactId: "c1" }).error, /goal/);
    assert.equal(cleanRoadmapBody(BODY).goal, BODY.goal);
  });

  it("labels what is confirmed, verified and unconfirmed, and sends the catalog without prices", () => {
    const t = buildRoadmapContent(cleanRoadmapBody(BODY), CATALOG);
    assert.ok(t.includes("THE GOAL (confirmed): A loan"));
    assert.ok(t.includes("- Revenue: $535K (2025) · source: 2025 return.pdf"));
    assert.ok(t.includes("Is the waiting list signed? → open question for the client"));
    assert.ok(t.includes("(self-prepared / related party)"));
    assert.ok(t.includes("- accounting_tax: Accounting & Tax."));
    assert.ok(!t.includes("999"));
  });

  it("keeps grounded findings, complete actions, known services; removes IDs", () => {
    const c = cleanRoadmapBody(BODY);
    const out = parseRoadmapReply(JSON.stringify(REPLY), c, CATALOG);
    assert.deepEqual(out.actions.map((a) => [a.id, a.owner, a.due, a.service_id]), [
      ["A1", "Accounting", "Week 8", "accounting_tax"],
      ["A2", "Accounting", "Week 1", ""],
    ]);
    assert.equal(out.dropped.actions, 2);
    assert.ok(!out.actions[1].what.includes("12-3456789"));
    assert.ok(!out.actions[1].what.includes("123456789012"));
    assert.deepEqual(out.findings.map((f) => [f.source, f.feeds]), [
      ["2025 return.pdf", "A2"],
      ["Team note", ""],
      ["Verified: Revenue", "6 months"],
    ]);
    assert.equal(out.dropped.findings, 2);
    assert.equal(out.path.length, 1);
    assert.deepEqual(out.client_view.steps, ["CPA statements."]);
    assert.equal(parseRoadmapReply("nothing", c, CATALOG), null);
  });

  it("redacts ID shapes but keeps ordinary amounts", () => {
    assert.equal(redact("EIN 12-3456789, SSN 123-45-6789, $202/mo, acct 000123456789"), "EIN [ID removed], SSN [ID removed], $202/mo, acct [number removed]");
  });

  it("runs end to end, refuses a plan with too few complete actions", async () => {
    _setCatalogForTests(CATALOG);
    const orig = globalThis.fetch;
    let reply = REPLY;
    globalThis.fetch = async (url) => {
      if (String(url).includes("/contacts/")) return new Response(JSON.stringify({ contact: { id: "c1", tags: ["bga_staff_case"], customFields: [] } }), { status: 200 });
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(reply) }], stop_reason: "end_turn" }), { status: 200 });
    };
    const req = () => new Request("https://x/asksolomon/case/workspace-roadmap", { method: "POST", headers: { "x-console-password": "pw", "content-type": "application/json" }, body: JSON.stringify(BODY) });
    try {
      let res = await handleWorkspaceRoadmap(req(), env, { checkPassword });
      let j = await res.json();
      assert.equal(res.status, 200);
      assert.equal(j.actions.length, 2);
      assert.equal(j.catalog_names.capital, "Business Capital");
      reply = { ...REPLY, actions: REPLY.actions.slice(2) };
      res = await handleWorkspaceRoadmap(req(), env, { checkPassword });
      assert.equal(res.status, 502);
    } finally {
      globalThis.fetch = orig;
      _setCatalogForTests(null);
    }
  });
});
