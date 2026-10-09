// BGA Copilot — generate_prep_brief tests (PR 7).
//
// Pins the write contract (ONLY swot_bga_prep_brief, NO tags) and
// the pure helpers (prompt, parse, validate, wrap).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  PREP_BRIEF_BANNER,
  PREP_BRIEF_SECTIONS,
  PREP_BRIEF_FIELD_KEY,
  buildPrepBriefSystemPrompt,
  buildPrepBriefUserPrompt,
  wrapGeneratedPrepBrief,
  parsePrepBriefSections,
  validateGeneratedPrepBrief,
  extractSmTags,
  handleGeneratePrepBrief,
} from "../src/bga_copilot/prep_brief.js";
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
function emptyCatalogRes() {
  return new Response(JSON.stringify({ customFields: [] }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}
function claudeRes(text, { stop_reason = "end_turn" } = {}) {
  return new Response(JSON.stringify({ content: [{ text }], stop_reason }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

// Minimal sample draft (banner + 8 sections) so handler's precondition
// "draft present" passes.
const SAMPLE_DRAFT = [
  DRAFT_BANNER, "",
  "## Section 1 — Where You Are Now", "intro",
  "## Section 2 — Verified Financial Position", "fin",
  "## Section 3 — Priority Issues", "priorities",
  "## Section 4 — 90-Day Commitments", "commits",
  "## Section 5 — 6-Month Direction", "six",
  "## Section 6 — 12-Month Goals / Reassessment", "twelve",
  "## Section 7 — Service Recommendations", "placeholder",
  "## Section 8 — Open Questions / Decisions", "questions",
].join("\n");

function sampleGoodBrief() {
  return [
    PREP_BRIEF_BANNER, "",
    "## Section 1 — Top 3 financial priorities (ranked, with VF provenance)",
    "1. Collect on AR_over_90 [VF: cash_on_hand = 184221, period=2026-09-30, source=bs.pdf]",
    "## Section 2 — Verified facts supporting each one",
    "cash levels [VF: cash_on_hand = 184221, period=2026-09-30, source=bs.pdf]",
    "## Section 3 — Assumptions still needing validation",
    "not yet validated: Q1 pipeline",
    "## Section 4 — Questions Miguel should ask",
    "What's AR concentration?",
    "## Section 5 — 90-day roadmap preview",
    "Collect, forecast, close faster",
    "## Section 6 — Likely objections or concerns",
    "Owner may push back on hiring freeze",
    "## Section 7 — Services worth discussing (with SM provenance)",
    "- Fractional CFO [SM: fractional_cfo_core, signal=low_margin_visibility]",
    "## Section 8 — Services NOT to recommend (with reason)",
    "- Growth capital (excluded by: active_tax_default)",
    "## Section 9 — Decisions the call needs to produce",
    "Confirm pricing cadence; confirm hire freeze",
  ].join("\n");
}

const FIXTURE_CATALOG = [{
  service_id: "fractional_cfo_core",
  name: "Fractional CFO — Core",
  problem_solved: "cash viz.",
  signals_relevant: ["low_margin_visibility"],
  when_not_to_recommend: [],
  dependencies: [],
  pricing: null,
}];

beforeEach(() => { _resetCatalogCacheForTests(); _setCatalogForTests(FIXTURE_CATALOG); });

describe("PREP_BRIEF_SECTIONS + buildPrepBriefSystemPrompt", () => {
  it("has exactly 9 sections, numbered 1–9", () => {
    assert.equal(PREP_BRIEF_SECTIONS.length, 9);
    for (let i = 0; i < 9; i++) assert.equal(PREP_BRIEF_SECTIONS[i].n, i + 1);
  });

  it("sections match spec §4.6 titles verbatim", () => {
    const expected = [
      "Top 3 financial priorities (ranked, with VF provenance)",
      "Verified facts supporting each one",
      "Assumptions still needing validation",
      "Questions Miguel should ask",
      "90-day roadmap preview",
      "Likely objections or concerns",
      "Services worth discussing (with SM provenance)",
      "Services NOT to recommend (with reason)",
      "Decisions the call needs to produce",
    ];
    for (let i = 0; i < 9; i++) assert.equal(PREP_BRIEF_SECTIONS[i].title, expected[i]);
  });

  it("system prompt names the INTERNAL banner verbatim", () => {
    assert.ok(buildPrepBriefSystemPrompt().includes(PREP_BRIEF_BANNER));
  });

  it("system prompt enumerates all 9 section headings", () => {
    const p = buildPrepBriefSystemPrompt();
    for (const s of PREP_BRIEF_SECTIONS) {
      assert.ok(p.includes(`## Section ${s.n} — ${s.title}`), `missing: Section ${s.n}`);
    }
  });

  it("system prompt describes all four provenance tag types", () => {
    const p = buildPrepBriefSystemPrompt();
    assert.match(p, /\[VF:/);
    assert.match(p, /\[CS:/);
    assert.match(p, /\[SJ:/);
    assert.match(p, /\[SM:/);
  });
});

describe("buildPrepBriefUserPrompt", () => {
  it("surfaces the draft, VF, intake, and services (included + excluded)", () => {
    const bundle = {
      contactId: "c1", business_name: "Acme", classification: "growth",
      verified_financials: { entries: [{ metric_id: "cash_on_hand", value: 100, period: "2026-09-30", source_doc: "bs.pdf" }] },
      intake: { paid_297_answers: [{ fieldKey: "paid_297_q_sell", label: "What do you sell?", value: "widgets" }] },
    };
    const matches = {
      included: [{ service_id: "a", name: "A", matched_signals: ["x"], problem_solved: "y" }],
      excluded: [{ service_id: "b", name: "B", excluded_by: ["z"] }],
    };
    const u = buildPrepBriefUserPrompt(bundle, { draft: SAMPLE_DRAFT, matches, catalogVersion: "abc" });
    assert.match(u, /Draft Roadmap/);
    assert.match(u, /cash_on_hand = 100/);
    assert.match(u, /widgets/);
    assert.match(u, /service_id=a/);
    assert.match(u, /primary_signal=x/);
    assert.match(u, /service_id=b/);
    assert.match(u, /excluded_by=z/);
    assert.match(u, /catalog_version=abc/);
  });

  it("tells Claude 'do not fabricate VF tags' when VF empty", () => {
    const u = buildPrepBriefUserPrompt(
      { contactId: "c1", verified_financials: { entries: [] }, intake: {} },
      { draft: "x", matches: { included: [], excluded: [] } },
    );
    assert.match(u, /do not fabricate VF/);
  });
});

describe("wrapGeneratedPrepBrief + parsePrepBriefSections", () => {
  it("prepends banner when missing, idempotent when present", () => {
    assert.ok(wrapGeneratedPrepBrief("## Section 1 — a\nbody").startsWith(PREP_BRIEF_BANNER));
    const already = `${PREP_BRIEF_BANNER}\n\n## Section 1 — a\nbody`;
    assert.equal(wrapGeneratedPrepBrief(already), already);
  });

  it("parsePrepBriefSections returns 9 sections numbered correctly", () => {
    const { sections } = parsePrepBriefSections(sampleGoodBrief());
    assert.equal(sections.length, 9);
    for (let i = 0; i < 9; i++) assert.equal(sections[i].n, i + 1);
  });
});

describe("validateGeneratedPrepBrief", () => {
  it("rejects stop_reason=max_tokens", () => {
    const r = validateGeneratedPrepBrief(sampleGoodBrief(), "max_tokens");
    assert.equal(r.ok, false);
    assert.match(r.error, /max_tokens/);
  });

  it("rejects a brief that parses to != 9 sections", () => {
    const bad = `${PREP_BRIEF_BANNER}\n\n## Section 1 — a\nbody`;
    const r = validateGeneratedPrepBrief(bad, "end_turn");
    assert.equal(r.ok, false);
    assert.match(r.error, /expected 9/);
  });

  it("rejects out-of-order sections", () => {
    const scrambled = [
      PREP_BRIEF_BANNER, "",
      "## Section 1 — a", "a",
      "## Section 3 — c", "c",
      "## Section 2 — b", "b",
      "## Section 4 — d", "d",
      "## Section 5 — e", "e",
      "## Section 6 — f", "f",
      "## Section 7 — g", "g",
      "## Section 8 — h", "h",
      "## Section 9 — i", "i",
    ].join("\n");
    const r = validateGeneratedPrepBrief(scrambled, "end_turn");
    assert.equal(r.ok, false);
    assert.match(r.error, /order wrong/);
  });

  it("passes on a well-formed 9-section brief", () => {
    const r = validateGeneratedPrepBrief(sampleGoodBrief(), "end_turn");
    assert.equal(r.ok, true);
    assert.ok(r.brief.startsWith(PREP_BRIEF_BANNER));
  });
});

describe("extractSmTags + SM provenance validation (Codex P1 on #98)", () => {
  it("extractSmTags pulls service_id + signal out of a section body", () => {
    const body = "- A [SM: fractional_cfo_core, signal=low_margin_visibility]\n- B [SM: bookkeeping_cleanup, signal=bookkeeping_cleanup_needed]";
    const tags = extractSmTags(body);
    assert.deepEqual(tags, [
      { service_id: "fractional_cfo_core", signal: "low_margin_visibility" },
      { service_id: "bookkeeping_cleanup", signal: "bookkeeping_cleanup_needed" },
    ]);
  });

  it("extractSmTags returns [] on empty / non-string input", () => {
    assert.deepEqual(extractSmTags(""), []);
    assert.deepEqual(extractSmTags(null), []);
    assert.deepEqual(extractSmTags(undefined), []);
  });

  it("validator passes a brief whose S7 SM tags all bind to matches.included", () => {
    const matches = {
      included: [{ service_id: "fractional_cfo_core", matched_signals: ["low_margin_visibility"] }],
      excluded: [],
    };
    const r = validateGeneratedPrepBrief(sampleGoodBrief(), "end_turn", { matches });
    assert.equal(r.ok, true);
  });

  it("validator rejects an unknown service_id in Section 7", () => {
    const matches = {
      included: [{ service_id: "some_other_service", matched_signals: ["low_margin_visibility"] }],
      excluded: [],
    };
    const r = validateGeneratedPrepBrief(sampleGoodBrief(), "end_turn", { matches });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown service_id/);
  });

  it("validator rejects a signal that didn't match this case for an included service", () => {
    const matches = {
      included: [{ service_id: "fractional_cfo_core", matched_signals: ["some_other_signal"] }],
      excluded: [],
    };
    const r = validateGeneratedPrepBrief(sampleGoodBrief(), "end_turn", { matches });
    assert.equal(r.ok, false);
    assert.match(r.error, /did not match this case/);
  });

  it("validator rejects any [SM:] tag in Section 8 (exclusions must not emit SM)", () => {
    const withBadS8 = sampleGoodBrief().replace(
      "## Section 8 — Services NOT to recommend (with reason)\n- Growth capital (excluded by: active_tax_default)",
      "## Section 8 — Services NOT to recommend (with reason)\n- Growth capital [SM: growth_capital_x, signal=low_margin_visibility]",
    );
    const matches = { included: [{ service_id: "fractional_cfo_core", matched_signals: ["low_margin_visibility"] }], excluded: [] };
    const r = validateGeneratedPrepBrief(withBadS8, "end_turn", { matches });
    assert.equal(r.ok, false);
    assert.match(r.error, /section 8 .* must not contain \[SM:\] tags/);
  });

  it("validator skips SM-tag checks when matches is not provided (pure-shape mode)", () => {
    // Backward-compat: tests that only exercise section layout
    // should still pass without supplying matches.
    const r = validateGeneratedPrepBrief(sampleGoodBrief(), "end_turn");
    assert.equal(r.ok, true);
  });

  it("(Codex P2 on #99) validator rejects when an included service has NO SM tag in S7", () => {
    // Catalog has fractional_cfo_core + bookkeeping_cleanup matching,
    // but the sample brief only tags fractional_cfo_core.
    const matches = {
      included: [
        { service_id: "fractional_cfo_core", matched_signals: ["low_margin_visibility"] },
        { service_id: "bookkeeping_cleanup", matched_signals: ["bookkeeping_cleanup_needed"] },
      ],
      excluded: [],
    };
    const r = validateGeneratedPrepBrief(sampleGoodBrief(), "end_turn", { matches });
    assert.equal(r.ok, false);
    assert.match(r.error, /missing SM tag\(s\) for included service\(s\): bookkeeping_cleanup/);
  });
});

describe("POST /asksolomon/case/generate-prep-brief — handleGeneratePrepBrief", () => {
  it("401 without x-console-password", async () => {
    const res = await handleGeneratePrepBrief(post({ contactId: "c1" }, {}), makeEnv(), { checkPassword });
    assert.equal(res.status, 401);
  });

  it("400 without contactId", async () => {
    const res = await handleGeneratePrepBrief(post({}), makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
  });

  it("400 when contact lacks swot_paid_297", async () => {
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields") && !String(url).includes("/contacts/")) return emptyCatalogRes();
      return ghlContactRes({ tags: ["swot_paid_47"] });
    });
    try {
      const res = await handleGeneratePrepBrief(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
    } finally { cap.restore(); }
  });

  it("400 when no draft is present on the contact", async () => {
    const cap = stubFetch((url) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      return ghlContactRes({ customFields: [] }); // no swot_growth_plan_draft
    });
    try {
      const res = await handleGeneratePrepBrief(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.match(body.error, /no draft/);
    } finally { cap.restore(); }
  });

  it("503 when ANTHROPIC_API_KEY missing", async () => {
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
      const res = await handleGeneratePrepBrief(post({ contactId: "c1" }), env, { checkPassword });
      assert.equal(res.status, 503);
    } finally { cap.restore(); }
  });

  it("502 when Claude returns stop_reason=max_tokens; NO PUT, NO tag", async () => {
    let putFired = false, tagFired = false;
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) return claudeRes(sampleGoodBrief(), { stop_reason: "max_tokens" });
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.endsWith("/tags")) { tagFired = true; return new Response("", { status: 200 }); }
      if (u.includes("/contacts/") && init?.method === "PUT") { putFired = true; return new Response("", { status: 200 }); }
      return ghlContactRes({
        customFields: [{ fieldKey: "contact.swot_growth_plan_draft", value: SAMPLE_DRAFT }],
      });
    });
    try {
      const res = await handleGeneratePrepBrief(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 502);
      assert.equal(putFired, false);
      assert.equal(tagFired, false);
    } finally { cap.restore(); }
  });

  it("happy path: writes ONLY swot_bga_prep_brief; no tags", async () => {
    let writeBody = null;
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) return claudeRes(sampleGoodBrief());
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.endsWith("/tags")) return new Response("", { status: 200 }); // allow fetch, but we'll assert never hit
      if (u.includes("/contacts/") && init?.method === "PUT") {
        writeBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      return ghlContactRes({
        // (Codex P1 on #98) Prep-brief SM provenance now validates
        // against matches.included — the fixture catalog's
        // fractional_cfo_core needs low_margin_visibility to fire for
        // the sample brief's [SM: fractional_cfo_core, signal=...] tag
        // to validate. Tag the contact so the matcher includes it.
        tags: ["swot_paid_297", "low_margin_visibility_opp"],
        customFields: [{ fieldKey: "contact.swot_growth_plan_draft", value: SAMPLE_DRAFT }],
      });
    });
    try {
      const res = await handleGeneratePrepBrief(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.ok(body.brief.startsWith(PREP_BRIEF_BANNER));
      // PUT body carries ONLY swot_bga_prep_brief.
      assert.ok(writeBody && Array.isArray(writeBody.customFields));
      assert.equal(writeBody.customFields.length, 1);
      assert.equal(writeBody.customFields[0].key, PREP_BRIEF_FIELD_KEY);
      // No /tags call fired.
      for (const c of cap.calls) assert.ok(!c.url.endsWith("/tags"), "prep-brief must not apply tags");
    } finally { cap.restore(); }
  });

  it("NEVER writes swot_growth_plan or swot_growth_plan_draft or applies any tag", async () => {
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) return claudeRes(sampleGoodBrief());
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.includes("/contacts/") && init?.method === "PUT") return new Response("", { status: 200 });
      return ghlContactRes({
        customFields: [{ fieldKey: "contact.swot_growth_plan_draft", value: SAMPLE_DRAFT }],
      });
    });
    try {
      await handleGeneratePrepBrief(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      for (const c of cap.calls) {
        if (c.url.endsWith("/tags")) assert.fail("prep-brief must not apply any tag");
        if (c.method === "PUT" && c.body) {
          const b = String(c.body);
          assert.ok(!b.includes('"swot_growth_plan"'), "must not touch swot_growth_plan field");
          assert.ok(!b.includes('"swot_growth_plan_draft"'), "must not touch swot_growth_plan_draft field");
          assert.ok(!b.includes("swot_growth_plan_ready"), "must not reference the _ready tag");
        }
      }
    } finally { cap.restore(); }
  });

  it("surfaces active signals + match counts in the response", async () => {
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) return claudeRes(sampleGoodBrief());
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.includes("/contacts/") && init?.method === "PUT") return new Response("", { status: 200 });
      return ghlContactRes({
        tags: ["swot_paid_297", "low_margin_visibility_opp"],
        customFields: [{ fieldKey: "contact.swot_growth_plan_draft", value: SAMPLE_DRAFT }],
      });
    });
    try {
      const res = await handleGeneratePrepBrief(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      const body = await res.json();
      assert.ok(body.active_signals.includes("low_margin_visibility"));
      assert.ok(typeof body.catalog_version === "string");
      assert.equal(body.matches_included_count, 1); // fractional_cfo_core matches
    } finally { cap.restore(); }
  });

  it("503 when GHL writeback fails", async () => {
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) return claudeRes(sampleGoodBrief());
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.includes("/contacts/") && init?.method === "PUT") return new Response("", { status: 500 });
      return ghlContactRes({
        // Same as happy path — need SM tag validation to pass before
        // the test can exercise the writeback-fail branch.
        tags: ["swot_paid_297", "low_margin_visibility_opp"],
        customFields: [{ fieldKey: "contact.swot_growth_plan_draft", value: SAMPLE_DRAFT }],
      });
    });
    try {
      const res = await handleGeneratePrepBrief(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 503);
    } finally { cap.restore(); }
  });
});
