// BGA Copilot — roadmap draft tests (PR 5b of the build).
//
// Pins the write contract (which field, which tag, which NEVER)
// and the pure helpers (prompt, parse, replace, wrap).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  DRAFT_BANNER,
  SECTIONS,
  buildRoadmapSystemPrompt,
  buildRoadmapUserPrompt,
  wrapGeneratedDraft,
  parseDraftSections,
  replaceSectionBody,
  handleGenerateRoadmapDraft,
  handleUpdateRoadmapSection,
} from "../src/bga_copilot/roadmap.js";
import { _resetCatalogCacheForTests } from "../src/ghl_catalog.js";

function makeEnv(extras = {}) {
  return {
    GHL_API_KEY: "test-ghl-key",
    GHL_LOCATION_ID: "test-loc",
    CONSOLE_PASSWORD: "test-password",
    ANTHROPIC_API_KEY: "test-anthropic-key",
    ...extras,
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
    const call = {
      url: String(url),
      method: init?.method || "GET",
      body: init?.body,
      headers: init?.headers,
    };
    calls.push(call);
    return responder(url, init);
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

function ghlContactRes({ tags = ["swot_paid_297"], customFields = [] } = {}) {
  return new Response(
    JSON.stringify({ contact: { id: "c1", companyName: "Acme Widgets", tags, customFields } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function claudeRes(text) {
  return new Response(JSON.stringify({ content: [{ text }] }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

function emptyCatalogRes() {
  return new Response(JSON.stringify({ customFields: [] }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

/**
 * Routes requests to the right stub by URL. Keeps individual tests
 * from reinventing the dispatcher.
 */
function router({ claude = null, contact = null, catalog = null, putOk = true, tagOk = true } = {}) {
  return (url, init) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) return claude || claudeRes(sampleGoodDraft());
    if (u.includes("/customFields") && !u.includes("/contacts/")) {
      return catalog || emptyCatalogRes();
    }
    if (u.includes("/contacts/") && u.endsWith("/tags")) {
      return new Response("", { status: tagOk ? 200 : 500 });
    }
    if (u.includes("/contacts/") && init?.method === "PUT") {
      return new Response("", { status: putOk ? 200 : 500 });
    }
    if (u.includes("/contacts/")) return contact || ghlContactRes();
    return new Response("not stubbed", { status: 500 });
  };
}

function sampleGoodDraft() {
  // Claude is instructed to start with the banner. Our wrap is
  // idempotent either way; the "with banner" shape is the normal case.
  return [
    DRAFT_BANNER,
    "",
    "## Section 1 — Where You Are Now",
    "Acme is a 12-year widget manufacturer. [CS: industry_tenure, from Q_A, \"started in 2014\"]",
    "",
    "## Section 2 — Verified Financial Position",
    "Cash on hand: $184,221. [VF: cash_on_hand = 184221, period=2026-09-30, source=balance_sheet_2026-09.pdf]",
    "",
    "## Section 3 — Priority Issues",
    "AR aging over 90 days has grown. not yet validated.",
    "",
    "## Section 4 — 90-Day Commitments",
    "Collect on AR_over_90.",
    "",
    "## Section 5 — 6-Month Direction",
    "Rebuild cash buffer.",
    "",
    "## Section 6 — 12-Month Goals / Reassessment",
    "Hiring reassessment Q3 2027.",
    "",
    "## Section 7 — Service Recommendations",
    "_Placeholder._ Service recommendations are populated by `match_services`.",
    "",
    "## Section 8 — Open Questions / Decisions",
    "What is the current customer concentration?",
  ].join("\n");
}

beforeEach(() => { _resetCatalogCacheForTests(); });

describe("SECTIONS + buildRoadmapSystemPrompt", () => {
  it("has exactly 8 sections, numbered 1–8, title + guidance each", () => {
    assert.equal(SECTIONS.length, 8);
    for (let i = 0; i < 8; i++) {
      assert.equal(SECTIONS[i].n, i + 1);
      assert.ok(SECTIONS[i].title && typeof SECTIONS[i].title === "string");
      assert.ok(SECTIONS[i].guidance);
    }
  });

  it("Section 7 is specifically Service Recommendations (per spec §4.3)", () => {
    assert.equal(SECTIONS[6].title, "Service Recommendations");
  });

  it("the system prompt names the DRAFT banner verbatim", () => {
    const p = buildRoadmapSystemPrompt();
    assert.ok(p.includes(DRAFT_BANNER));
  });

  it("the system prompt enumerates all 8 section headings", () => {
    const p = buildRoadmapSystemPrompt();
    for (const s of SECTIONS) {
      assert.ok(p.includes(`## Section ${s.n} — ${s.title}`), `missing: Section ${s.n}`);
    }
  });

  it("the system prompt describes all four provenance tag types (§3.1)", () => {
    const p = buildRoadmapSystemPrompt();
    assert.match(p, /\[VF:/);
    assert.match(p, /\[CS:/);
    assert.match(p, /\[SJ:/);
    assert.match(p, /\[SM:/);
  });
});

describe("buildRoadmapUserPrompt", () => {
  it("surfaces verified financials, intake answers, and brief", () => {
    const bundle = {
      contactId: "c1",
      business_name: "Acme",
      classification: "growth",
      verified_financials: { entries: [{ metric_id: "cash_on_hand", value: 100, period: "2026-09-30", source_doc: "bs.pdf" }] },
      intake: {
        business_playbook: "## playbook",
        strategist_brief: "## brief",
        full_diagnostic: "",
        paid_297_answers: [{ fieldKey: "paid_297_q_sell", label: "What do you sell?", value: "widgets" }],
      },
    };
    const u = buildRoadmapUserPrompt(bundle);
    assert.match(u, /cash_on_hand = 100/);
    assert.match(u, /paid_297_q_sell/);
    assert.match(u, /What do you sell\?/);
    assert.match(u, /widgets/);
    assert.match(u, /## brief/);
    assert.match(u, /## playbook/);
  });

  it("tells Claude 'do not fabricate VF tags' when there are no verified entries", () => {
    const bundle = {
      contactId: "c1", business_name: "Acme", classification: "growth",
      verified_financials: { entries: [] },
      intake: { business_playbook: "", strategist_brief: "", full_diagnostic: "", paid_297_answers: [] },
    };
    const u = buildRoadmapUserPrompt(bundle);
    assert.match(u, /do not fabricate VF/);
  });
});

describe("wrapGeneratedDraft", () => {
  it("prepends the banner when missing", () => {
    const wrapped = wrapGeneratedDraft("## Section 1 — Where You Are Now\nbody");
    assert.ok(wrapped.startsWith(DRAFT_BANNER));
  });
  it("is idempotent when the banner is already present", () => {
    const start = `${DRAFT_BANNER}\n\n## Section 1 — Where You Are Now\nbody`;
    assert.equal(wrapGeneratedDraft(start), start);
  });
  it("trims surrounding whitespace", () => {
    const wrapped = wrapGeneratedDraft("   \n\n## Section 1 — Where You Are Now\nbody\n\n");
    assert.ok(wrapped.endsWith("body"));
  });
});

describe("parseDraftSections + replaceSectionBody", () => {
  const draft = sampleGoodDraft();

  it("parses 8 sections in the sample draft, numbered correctly", () => {
    const { sections } = parseDraftSections(draft);
    assert.equal(sections.length, 8);
    for (let i = 0; i < 8; i++) assert.equal(sections[i].n, i + 1);
  });

  it("prefix carries the banner", () => {
    const { prefix } = parseDraftSections(draft);
    assert.ok(prefix.includes(DRAFT_BANNER));
  });

  it("replaces only the targeted section's body", () => {
    const next = replaceSectionBody(draft, 3, "- Pricing is the real issue, not AR [SJ: 2026-10-09T14:32, \"pricing not AR\"]");
    const { sections } = parseDraftSections(next);
    assert.equal(sections.length, 8);
    assert.match(sections[2].body, /pricing not AR/);
    // Every other section's body must be unchanged.
    const original = parseDraftSections(draft).sections;
    for (let i = 0; i < 8; i++) {
      if (i === 2) continue;
      assert.equal(sections[i].body, original[i].body, `section ${i + 1} drifted`);
    }
  });

  it("preserves the banner in the replaced draft", () => {
    const next = replaceSectionBody(draft, 5, "updated body");
    assert.ok(next.includes(DRAFT_BANNER));
  });

  it("returns null when the target section isn't in the current draft", () => {
    const partial = `${DRAFT_BANNER}\n\n## Section 1 — Where You Are Now\nbody`;
    assert.equal(replaceSectionBody(partial, 3, "x"), null);
  });

  it("tolerates em-dash and hyphen in section headings", () => {
    const alt = `${DRAFT_BANNER}\n\n## Section 1 - Where You Are Now\nbody\n`;
    const { sections } = parseDraftSections(alt);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].n, 1);
  });
});

describe("POST /asksolomon/case/generate-roadmap-draft — handleGenerateRoadmapDraft", () => {
  it("401 without x-console-password", async () => {
    const res = await handleGenerateRoadmapDraft(post({ contactId: "c1" }, {}), makeEnv(), { checkPassword });
    assert.equal(res.status, 401);
  });

  it("400 without contactId", async () => {
    const cap = stubFetch(router());
    try {
      const res = await handleGenerateRoadmapDraft(post({}), makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
    } finally { cap.restore(); }
  });

  it("400 when contact lacks swot_paid_297", async () => {
    const cap = stubFetch(router({ contact: ghlContactRes({ tags: ["swot_paid_47"] }) }));
    try {
      const res = await handleGenerateRoadmapDraft(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.match(body.error, /swot_paid_297/);
    } finally { cap.restore(); }
  });

  it("503 when ANTHROPIC_API_KEY is missing", async () => {
    const cap = stubFetch(router());
    try {
      const env = makeEnv();
      delete env.ANTHROPIC_API_KEY;
      const res = await handleGenerateRoadmapDraft(post({ contactId: "c1" }), env, { checkPassword });
      assert.equal(res.status, 503);
    } finally { cap.restore(); }
  });

  it("503 when Claude returns non-ok", async () => {
    const cap = stubFetch(router({ claude: new Response("boom", { status: 500 }) }));
    try {
      const res = await handleGenerateRoadmapDraft(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 503);
    } finally { cap.restore(); }
  });

  it("503 when GHL writeback fails", async () => {
    const cap = stubFetch(router({ putOk: false }));
    try {
      const res = await handleGenerateRoadmapDraft(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 503);
    } finally { cap.restore(); }
  });

  it("happy path: writes swot_growth_plan_draft and applies swot_growth_plan_drafted", async () => {
    let writeBody = null;
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) return claudeRes(sampleGoodDraft());
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.includes("/contacts/") && u.endsWith("/tags")) return new Response("", { status: 200 });
      if (u.includes("/contacts/") && init?.method === "PUT") {
        writeBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      if (u.includes("/contacts/")) return ghlContactRes();
      return new Response("not stubbed", { status: 500 });
    });
    try {
      const res = await handleGenerateRoadmapDraft(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.drafted_tag_applied, true);
      assert.ok(body.draft.startsWith(DRAFT_BANNER));
      assert.match(body.draft, /## Section 1 — Where You Are Now/);

      // The PUT must have carried swot_growth_plan_draft only.
      assert.ok(writeBody && Array.isArray(writeBody.customFields));
      const field = writeBody.customFields.find((f) => f.key === "swot_growth_plan_draft");
      assert.ok(field, "expected swot_growth_plan_draft in PUT body");
      assert.ok(field.field_value.startsWith(DRAFT_BANNER));

      // The tag endpoint must have been hit with swot_growth_plan_drafted.
      const tagCall = cap.calls.find((c) => c.url.endsWith("/tags"));
      assert.ok(tagCall);
      assert.match(String(tagCall.body), /swot_growth_plan_drafted/);
    } finally { cap.restore(); }
  });

  it("NEVER writes swot_growth_plan or applies swot_growth_plan_ready", async () => {
    const cap = stubFetch(router());
    try {
      await handleGenerateRoadmapDraft(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      for (const c of cap.calls) {
        if (c.method === "PUT" && c.body) {
          const b = String(c.body);
          // Note: swot_growth_plan_draft and swot_growth_plan_drafted
          // are both allowed and both contain "swot_growth_plan";
          // check that the exact dangerous tokens don't appear.
          assert.ok(!b.includes('"swot_growth_plan"'), "endpoint must not touch swot_growth_plan field");
          assert.ok(!b.includes("swot_growth_plan_ready"), "endpoint must not touch swot_growth_plan_ready");
        }
        if (c.url.endsWith("/tags") && c.body) {
          assert.ok(!String(c.body).includes("swot_growth_plan_ready"), "must not apply _ready tag");
        }
      }
    } finally { cap.restore(); }
  });

  it("drafted_tag_applied=false when the tag endpoint fails, but draft still saves", async () => {
    const cap = stubFetch(router({ tagOk: false }));
    try {
      const res = await handleGenerateRoadmapDraft(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.drafted_tag_applied, false);
    } finally { cap.restore(); }
  });
});

describe("POST /asksolomon/case/update-roadmap-section — handleUpdateRoadmapSection", () => {
  const draft = sampleGoodDraft();

  it("401 without x-console-password", async () => {
    const res = await handleUpdateRoadmapSection(
      post({ contactId: "c1", section_number: 3, new_content: "x" }, {}),
      makeEnv(), { checkPassword },
    );
    assert.equal(res.status, 401);
  });

  it("400 when section_number is out of range", async () => {
    const cap = stubFetch(router());
    try {
      let res = await handleUpdateRoadmapSection(
        post({ contactId: "c1", section_number: 0, new_content: "x" }),
        makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
      res = await handleUpdateRoadmapSection(
        post({ contactId: "c1", section_number: 9, new_content: "x" }),
        makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
      res = await handleUpdateRoadmapSection(
        post({ contactId: "c1", section_number: "three", new_content: "x" }),
        makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
    } finally { cap.restore(); }
  });

  it("400 when new_content is empty / whitespace", async () => {
    const cap = stubFetch(router());
    try {
      const res = await handleUpdateRoadmapSection(
        post({ contactId: "c1", section_number: 3, new_content: "   " }),
        makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
    } finally { cap.restore(); }
  });

  it("400 when no draft is present on the contact", async () => {
    const cap = stubFetch(router({
      contact: ghlContactRes({ customFields: [] }),
    }));
    try {
      const res = await handleUpdateRoadmapSection(
        post({ contactId: "c1", section_number: 3, new_content: "fix" }),
        makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
      const b = await res.json();
      assert.match(b.error, /no draft/);
    } finally { cap.restore(); }
  });

  it("404 when the target section is missing from the current draft", async () => {
    const partial = `${DRAFT_BANNER}\n\n## Section 1 — Where You Are Now\nbody\n`;
    const cap = stubFetch(router({
      contact: ghlContactRes({
        customFields: [{ fieldKey: "contact.swot_growth_plan_draft", value: partial }],
      }),
    }));
    try {
      const res = await handleUpdateRoadmapSection(
        post({ contactId: "c1", section_number: 3, new_content: "fix" }),
        makeEnv(), { checkPassword });
      assert.equal(res.status, 404);
    } finally { cap.restore(); }
  });

  it("happy path: replaces only the targeted section and preserves the banner", async () => {
    let writeBody = null;
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.includes("/contacts/") && init?.method === "PUT") {
        writeBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      if (u.includes("/contacts/")) return ghlContactRes({
        customFields: [{ fieldKey: "contact.swot_growth_plan_draft", value: draft }],
      });
      return new Response("not stubbed", { status: 500 });
    });
    try {
      const res = await handleUpdateRoadmapSection(
        post({
          contactId: "c1",
          section_number: 3,
          new_content: "- Pricing is the real issue, not AR [SJ: 2026-10-09T14:32, \"pricing not AR\"]",
        }),
        makeEnv(), { checkPassword });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.section_number, 3);
      assert.match(body.draft, /pricing not AR/);
      assert.ok(body.draft.includes(DRAFT_BANNER));

      // All 8 sections still present after replace.
      const { sections } = parseDraftSections(body.draft);
      assert.equal(sections.length, 8);

      // PUT body targets swot_growth_plan_draft and no other field.
      const stored = writeBody.customFields.find((f) => f.key === "swot_growth_plan_draft");
      assert.ok(stored);
      assert.equal(writeBody.customFields.length, 1);
    } finally { cap.restore(); }
  });

  it("never applies swot_growth_plan_drafted on a section edit (it's a generate-only signal)", async () => {
    const cap = stubFetch(router({
      contact: ghlContactRes({
        customFields: [{ fieldKey: "contact.swot_growth_plan_draft", value: draft }],
      }),
    }));
    try {
      await handleUpdateRoadmapSection(
        post({ contactId: "c1", section_number: 1, new_content: "updated" }),
        makeEnv(), { checkPassword });
      for (const c of cap.calls) {
        if (c.url.endsWith("/tags")) {
          assert.fail("section edit must not apply any tag");
        }
      }
    } finally { cap.restore(); }
  });
});
