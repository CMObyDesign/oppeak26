// BGA Copilot — challenge_roadmap tests (PR 8).
//
// Pins: READ-ONLY contract (no PUT, no tag), auth, bad input,
// draft-missing refusal, validator rejects truncation + missing
// lenses + missing verdict, verdict shape.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  buildChallengeSystemPrompt,
  buildChallengeUserPrompt,
  validateChallengeOutput,
  handleChallengeRoadmap,
} from "../src/bga_copilot/challenge.js";
import { _resetCatalogCacheForTests } from "../src/ghl_catalog.js";
import { _setCatalogForTests } from "../src/bga_copilot/services_catalog.js";
import { DRAFT_BANNER } from "../src/bga_copilot/roadmap.js";

function makeEnv() {
  return {
    GHL_API_KEY: "test-ghl",
    GHL_LOCATION_ID: "test-loc",
    CONSOLE_PASSWORD: "test-password",
    ANTHROPIC_API_KEY: "test-anthropic",
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
    JSON.stringify({ contact: { id: "c1", companyName: "Acme", tags, customFields } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
function claudeRes(text, { stop_reason = "end_turn" } = {}) {
  return new Response(JSON.stringify({ content: [{ text }], stop_reason }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}
function emptyCatalogRes() {
  return new Response(JSON.stringify({ customFields: [] }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

const SAMPLE_DRAFT = [
  DRAFT_BANNER, "",
  "## Section 1 — Where You Are Now", "intro",
  "## Section 2 — Verified Financial Position", "fin",
  "## Section 3 — Priority Issues", "pri",
  "## Section 4 — 90-Day Commitments", "commit",
  "## Section 5 — 6-Month Direction", "six",
  "## Section 6 — 12-Month Goals / Reassessment", "twelve",
  "## Section 7 — Service Recommendations", "placeholder",
  "## Section 8 — Open Questions / Decisions", "qs",
].join("\n");

function sampleCritique(verdict = "REVISE") {
  return [
    "## Lenses",
    "",
    "### 1. Symptom vs. cause",
    "Section 3 looks symptom-focused on AR.",
    "",
    "### 2. Supportability from verified facts",
    "Section 4 commitment on hiring: not supportable from current VF.",
    "",
    "### 3. Catalog bias",
    "Section 7 fractional_cfo_core signal is weak given revenue.",
    "",
    "### 4. Priority dependencies",
    "Section 4 item 2 depends on Section 3 item 1; not stated.",
    "",
    "### 5. 12-month certainty",
    "Section 6 reads certain, should be reassessment.",
    "",
    "## Verdict",
    `**${verdict}** — Section 4 hiring + Section 6 tone.`,
  ].join("\n");
}

beforeEach(() => { _resetCatalogCacheForTests(); _setCatalogForTests([]); });

describe("buildChallengeSystemPrompt", () => {
  it("declares the five lens headings and the verdict section", () => {
    const p = buildChallengeSystemPrompt();
    assert.match(p, /### 1\. Symptom vs\. cause/);
    assert.match(p, /### 2\. Supportability from verified facts/);
    assert.match(p, /### 3\. Catalog bias/);
    assert.match(p, /### 4\. Priority dependencies/);
    assert.match(p, /### 5\. 12-month certainty/);
    assert.match(p, /## Verdict/);
  });

  it("enumerates the three verdict strings", () => {
    const p = buildChallengeSystemPrompt();
    assert.match(p, /SHIP IT \(minor refinements\)/);
    assert.match(p, /REVISE/);
    assert.match(p, /BLOCK/);
  });

  it("tells Claude not to propose new SM / VF tags or client copy", () => {
    const p = buildChallengeSystemPrompt();
    assert.match(p, /not a draft/);
    assert.match(p, /critique/);
  });
});

describe("buildChallengeUserPrompt", () => {
  it("surfaces the draft, VF, intake, and matches", () => {
    const u = buildChallengeUserPrompt({
      contactId: "c1", business_name: "Acme", classification: "growth",
      verified_financials: { entries: [{ metric_id: "cash_on_hand", value: 100, period: "p", source_doc: "d" }] },
      intake: { paid_297_answers: [{ fieldKey: "paid_297_q_sell", label: "What do you sell?", value: "widgets" }] },
    }, {
      draft: SAMPLE_DRAFT,
      matches: {
        included: [{ service_id: "a", name: "A", matched_signals: ["x"] }],
        excluded: [{ service_id: "b", name: "B", excluded_by: ["z"] }],
      },
      catalogVersion: "abc",
    });
    assert.match(u, /Current Draft Roadmap/);
    assert.match(u, /cash_on_hand = 100/);
    assert.match(u, /widgets/);
    assert.match(u, /service_id=a/);
    assert.match(u, /primary_signal=x/);
    assert.match(u, /excluded_by=z/);
    assert.match(u, /catalog_version=abc/);
  });

  it("prompts the model to say 'not supportable from current VF' when VF is empty", () => {
    const u = buildChallengeUserPrompt(
      { contactId: "c1", verified_financials: { entries: [] }, intake: {} },
      { draft: "x", matches: { included: [], excluded: [] } },
    );
    assert.match(u, /not supportable from current VF/);
  });
});

describe("validateChallengeOutput", () => {
  it("rejects max_tokens truncation", () => {
    const r = validateChallengeOutput(sampleCritique(), "max_tokens");
    assert.equal(r.ok, false);
    assert.match(r.error, /max_tokens/);
  });

  it("rejects a critique missing a lens heading", () => {
    const bad = sampleCritique().replace("### 4. Priority dependencies", "### 4. Something else");
    const r = validateChallengeOutput(bad, "end_turn");
    assert.equal(r.ok, false);
    assert.match(r.error, /missing lens heading/);
  });

  it("rejects a critique missing the ## Verdict section", () => {
    const bad = sampleCritique().replace("## Verdict", "## something");
    const r = validateChallengeOutput(bad, "end_turn");
    assert.equal(r.ok, false);
    assert.match(r.error, /Verdict/);
  });

  it("rejects a critique with a non-canonical verdict", () => {
    const bad = sampleCritique().replace("**REVISE** — Section 4", "**MAYBE** — Section 4");
    const r = validateChallengeOutput(bad, "end_turn");
    assert.equal(r.ok, false);
    assert.match(r.error, /SHIP IT.*REVISE.*BLOCK/);
  });

  it("passes on each of the three verdicts and returns it", () => {
    for (const v of ["SHIP IT (minor refinements)", "REVISE", "BLOCK"]) {
      const r = validateChallengeOutput(sampleCritique(v), "end_turn");
      assert.equal(r.ok, true, `failed for verdict=${v}`);
      assert.equal(r.verdict, v);
    }
  });
});

describe("POST /asksolomon/case/challenge-roadmap — handleChallengeRoadmap", () => {
  it("401 without x-console-password", async () => {
    const res = await handleChallengeRoadmap(post({ contactId: "c1" }, {}), makeEnv(), { checkPassword });
    assert.equal(res.status, 401);
  });

  it("400 without contactId", async () => {
    const res = await handleChallengeRoadmap(post({}), makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
  });

  it("400 when contact lacks swot_paid_297", async () => {
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields") && !String(url).includes("/contacts/")) return emptyCatalogRes();
      return ghlContactRes({ tags: ["swot_paid_47"] });
    });
    try {
      const res = await handleChallengeRoadmap(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
    } finally { cap.restore(); }
  });

  it("400 when no draft present", async () => {
    const cap = stubFetch((url) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      return ghlContactRes({ customFields: [] });
    });
    try {
      const res = await handleChallengeRoadmap(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
      const b = await res.json();
      assert.match(b.error, /no draft/);
    } finally { cap.restore(); }
  });

  it("503 w/o ANTHROPIC_API_KEY", async () => {
    const cap = stubFetch((url) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      return ghlContactRes({
        customFields: [{ fieldKey: "contact.swot_growth_plan_draft", value: SAMPLE_DRAFT }],
      });
    });
    try {
      const env = makeEnv();
      delete env.ANTHROPIC_API_KEY;
      const res = await handleChallengeRoadmap(post({ contactId: "c1" }), env, { checkPassword });
      assert.equal(res.status, 503);
    } finally { cap.restore(); }
  });

  it("502 on max_tokens; NO PUT, NO tag", async () => {
    let putFired = false, tagFired = false;
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) return claudeRes(sampleCritique(), { stop_reason: "max_tokens" });
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.endsWith("/tags")) { tagFired = true; return new Response("", { status: 200 }); }
      if (u.includes("/contacts/") && init?.method === "PUT") { putFired = true; return new Response("", { status: 200 }); }
      return ghlContactRes({
        customFields: [{ fieldKey: "contact.swot_growth_plan_draft", value: SAMPLE_DRAFT }],
      });
    });
    try {
      const res = await handleChallengeRoadmap(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 502);
      assert.equal(putFired, false);
      assert.equal(tagFired, false);
    } finally { cap.restore(); }
  });

  it("happy path is READ-ONLY: no PUT, no tag, response persisted=false", async () => {
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) return claudeRes(sampleCritique("SHIP IT (minor refinements)"));
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.includes("/contacts/") && init?.method === "PUT") assert.fail("challenge must not issue a PUT");
      if (u.endsWith("/tags")) assert.fail("challenge must not apply any tag");
      return ghlContactRes({
        customFields: [{ fieldKey: "contact.swot_growth_plan_draft", value: SAMPLE_DRAFT }],
      });
    });
    try {
      const res = await handleChallengeRoadmap(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.persisted, false);
      assert.equal(body.verdict, "SHIP IT (minor refinements)");
      assert.match(body.critique, /## Lenses/);
      // Sanity: confirm no PUT or /tags call happened (defense in
      // depth against the assertions above being a no-op by accident).
      for (const c of cap.calls) {
        assert.notEqual(c.method, "PUT");
        assert.ok(!c.url.endsWith("/tags"));
      }
    } finally { cap.restore(); }
  });

  it("surfaces active signals + catalog version in the response", async () => {
    const cap = stubFetch((url) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) return claudeRes(sampleCritique("REVISE"));
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      return ghlContactRes({
        tags: ["swot_paid_297", "low_margin_visibility_opp"],
        customFields: [{ fieldKey: "contact.swot_growth_plan_draft", value: SAMPLE_DRAFT }],
      });
    });
    try {
      const res = await handleChallengeRoadmap(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      const body = await res.json();
      assert.ok(body.active_signals.includes("low_margin_visibility"));
      assert.ok(typeof body.catalog_version === "string" && body.catalog_version.length > 0);
    } finally { cap.restore(); }
  });
});
