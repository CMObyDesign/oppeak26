// BGA Copilot — case workspace roadmap (src/bga_copilot/case_roadmap.js).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { handleWorkspaceRoadmap, cleanRoadmapBody, buildRoadmapContent, parseRoadmapReply, redact, roadmapGaps, claimFits } from "../src/bga_copilot/case_roadmap.js";
import { _setCatalogForTests } from "../src/bga_copilot/services_catalog.js";
import { isAllowlisted } from "../src/portal_pass.js";

const env = { CONSOLE_PASSWORD: "pw", ANTHROPIC_API_KEY: "k", GHL_API_KEY: "g", GHL_LOCATION_ID: "loc" };
const checkPassword = (r) => r.headers.get("x-console-password") === "pw";
const CATALOG = [{ service_id: "accounting_tax", name: "Accounting & Tax", problem_solved: "Books and returns.", pricing: { amount_usd: 999 } }, { service_id: "capital", name: "Business Capital", problem_solved: "Funding." }];

const BODY = {
  contactId: "c1",
  goal: "A loan against the paid-off equipment, plus a line of credit.",
  confirmed: [{ question: "Who owns the business?", answer: "Brandon, 100%.", source: "2025 return.pdf" }],
  numbers: [{ name: "Revenue", value: "$535K", period: "2025", source: "2025 return.pdf" }, { name: "Cash on hand", value: "$26K", period: "Oct", source: "" }],
  unconfirmed: [{ question: "Is the waiting list signed?", suggested: "", source: "" }],
  documents: [
    { filename: "2025 return.pdf", label: "2025 federal return", summary: "Owes $155K.", self_prepared: true, key_facts: [{ fact: "Owes $155,621", quote: "Amount you owe 155,621" }] },
    { filename: "return-12-3456789.pdf", label: "2024 return", summary: "Receipts of $549K." },
  ],
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
    { kind: "weak_spot", vital_sign: "Money", text: "Receipts fell", evidence: "2024 vs 2025", source: "return-12-3456789.pdf", quote: "Receipts of $549K", feeds: "6 months" },
    { kind: "threat", vital_sign: "Money", text: "Invented claim", evidence: "Return", source: "2025 return.pdf", quote: "Line 99: owes $2M", feeds: "6 months" },
    { kind: "threat", vital_sign: "Money", text: "No evidence given", evidence: "", source: "2025 return.pdf", feeds: "6 months" },
    { kind: "nope", vital_sign: "Money", text: "x", source: "Team note" },
  ],
  path: [{ when: "Now to day 90", what: "A file a lender can rely on." }, { when: "Then", what: "Equipment loan." }, { when: "", what: "x" }],
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
    assert.ok(t.includes("- Who owns the business? → Brandon, 100%. (from 2025 return.pdf)"));
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
    assert.deepEqual(out.findings.map((f) => [f.source, f.feeds, f.unconfirmed, f.quote]), [
      ["2025 return.pdf", "A2", true, "Amount you owe 155,621"], // "$310K" isn't a figure this document states
      ["Team note", "", false, ""],
      ["Verified: Revenue", "6 months", false, ""],
      ["return-[ID removed].pdf", "6 months", false, "Receipts of $549K"], // the file name's EIN is redacted
      ["2025 return.pdf", "6 months", true, ""], // a quote the document doesn't have: kept only as unconfirmed
    ]);
    assert.equal(out.dropped.findings, 3); // bad kind, ungrounded source, no evidence
    assert.equal(out.path.length, 2);
    assert.deepEqual(out.client_view.steps, ["CPA statements."]);
    assert.equal(parseRoadmapReply("nothing", c, CATALOG), null);
  });

  it("a number is verified only with a real document source; key facts go to Solomon", () => {
    const c = cleanRoadmapBody(BODY);
    assert.deepEqual(c.numbers.map((n) => n.name), ["Revenue"]);
    const t = buildRoadmapContent(c, CATALOG);
    assert.ok(!t.includes("Cash on hand: $26K"));
    assert.ok(t.includes('· Owes $155,621 ("Amount you owe 155,621")'));
  });

  it("a roadmap missing a section isn't accepted", () => {
    const full = { findings: [{}], path: [{}, {}], actions: [{}, {}], client_view: { title: "t", intro: "i", steps: ["s"] } };
    assert.deepEqual(roadmapGaps(full), []);
    assert.deepEqual(roadmapGaps({ ...full, findings: [], path: [{}], client_view: { title: "", intro: "", steps: [] } }), ["findings with a source", "the path from now to 12 months", "the client preview"]);
  });

  it("a claim's figures must match its source, or it's marked unconfirmed", () => {
    assert.equal(claimFits("Revenue held at $535K", "$535K 2025"), true);
    assert.equal(claimFits("Revenue of $2M is at risk", "$535K 2025"), false);
    assert.equal(claimFits("About $310K owed", "Owes $155,621 for 2024 and $155,000 for 2025, about $310K"), true);
    assert.equal(claimFits("Margins fell to 40%", "gross margin 64%"), false);
    assert.equal(claimFits("Call 2 or 3 lenders by Week 12", ""), true); // no figures to check
    assert.equal(claimFits("Revenue is $2,025", "$535K 2025"), false); // a year isn't an amount
    assert.equal(claimFits("Revenue is $535", "Revenue is $535 thousand"), false); // thousand is scaled
    assert.equal(claimFits("Revenue is $535,000", "Revenue is $535 thousand"), true);
    assert.equal(claimFits("Revenue in 2025 was $535K", "$535K 2025"), true);
    const c = cleanRoadmapBody(BODY);
    const out = parseRoadmapReply(JSON.stringify({ ...REPLY, findings: [
      { kind: "threat", vital_sign: "Money", text: "A $2M revenue threat", evidence: "Return", source: "Verified: Revenue", feeds: "6 months" },
      { kind: "strength", vital_sign: "Money", text: "Revenue of $535K", evidence: "Return", source: "Verified: Revenue", feeds: "6 months" },
      { kind: "weak_spot", vital_sign: "Money", text: "Loses $90K a month", evidence: "Liz's note", source: "Team note", feeds: "6 months" },
    ] }), c, CATALOG);
    assert.deepEqual(out.findings.map((f) => f.unconfirmed), [true, false, true]);
  });

  it("an action's starting point must come from a source; lender figures are left blank", () => {
    const c = cleanRoadmapBody(BODY);
    const out = parseRoadmapReply(JSON.stringify({ ...REPLY, actions: [
      { id: "A1", what: "Apply for a $1M equipment loan at 7%", vital_sign: "Money", owner: "Advisor", due: "Week 10", number: "Term sheets", start: "$2M in pipeline", target: "$1M at 2% over 7 years" },
      { id: "A2", what: "Grow revenue", vital_sign: "Money", owner: "Advisor", due: "Week 12", number: "Revenue", start: "$535K", target: "$600K" },
    ] }), c, CATALOG);
    assert.equal(out.actions[0].start, "Not confirmed yet");
    assert.equal(out.actions[0].what, "Apply for a [from the lender] equipment loan at [from the lender]");
    assert.equal(out.actions[0].target, "[from the lender] at [from the lender] over 7 years");
    assert.equal(out.actions[1].start, "$535K"); // the verified revenue
    assert.equal(out.actions[1].target, "$600K"); // a goal, not a loan figure
  });

  it("the client preview keeps only confirmed figures", () => {
    const c = cleanRoadmapBody(BODY);
    const out = parseRoadmapReply(JSON.stringify({ ...REPLY, client_view: { title: "Your path", intro: "Revenue was $535K last year. You could grow to $4M.", steps: ["Secure the suggested $2M loan.", "Keep 40% margins."], closing: "We'll check in at Week 4." } }), c, CATALOG);
    assert.equal(out.client_view.intro, "Revenue was $535K last year. You could grow to [to confirm].");
    assert.deepEqual(out.client_view.steps, ["Secure the suggested [from the lender] loan.", "Keep [to confirm] margins."]);
    assert.equal(out.client_view.closing, "We'll check in at Week 4.");
  });

  it("redacts labelled account numbers in any common shape", () => {
    assert.equal(redact("acct 12345678, account # 1234-5678, routing number 021000021, card ending in 4242 9999, Week 12"), "acct [number removed], account [number removed], routing [number removed], card [number removed], Week 12");
    assert.equal(redact("card 4111 1111 1111 1111"), "card [number removed]");
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
