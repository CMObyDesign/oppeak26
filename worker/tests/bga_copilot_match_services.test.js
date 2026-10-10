// BGA Copilot — match_services tests (PR 6).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  matchServices,
  formatSection7Body,
  handleMatchServices,
} from "../src/bga_copilot/match_services.js";
import {
  _setCatalogForTests,
  _effectiveCatalog,
} from "../src/bga_copilot/services_catalog.js";
import { _resetCatalogCacheForTests } from "../src/ghl_catalog.js";
import { DRAFT_BANNER } from "../src/bga_copilot/roadmap.js";

const FIXTURE_CATALOG = [
  {
    service_id: "fractional_cfo_core",
    name: "Fractional CFO — Core",
    problem_solved: "Owner has no forward cash visibility.",
    signals_relevant: [
      "low_margin_visibility",
      "no_13_week_cash_forecast",
      "monthly_close_absent_or_late",
    ],
    when_not_to_recommend: [
      "active_tax_default",
      "revenue_band_below_500k",
      "books_not_closable",
    ],
    dependencies: ["Reliable bookkeeping"],
    pricing: { model: "monthly_retainer", note: "pricing TBD" },
  },
  {
    service_id: "bookkeeping_cleanup",
    name: "Bookkeeping Cleanup",
    problem_solved: "Books are behind.",
    signals_relevant: ["bookkeeping_cleanup_needed"],
    when_not_to_recommend: ["legal_distress"],
    dependencies: [],
    pricing: { model: "project_fee", note: "scoped per engagement" },
  },
  {
    service_id: "tax_strategy_consult",
    name: "Tax Strategy Consult",
    problem_solved: "Taxes paid but not planned.",
    signals_relevant: ["tax_filings_current_but_strategy_absent"],
    when_not_to_recommend: ["active_tax_default"],
    dependencies: [],
    pricing: null,
  },
];

function makeEnv() {
  return {
    GHL_API_KEY: "test-ghl",
    GHL_LOCATION_ID: "test-loc",
    CONSOLE_PASSWORD: "test-password",
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

beforeEach(() => { _resetCatalogCacheForTests(); _setCatalogForTests(FIXTURE_CATALOG); });

describe("matchServices — pure matcher", () => {
  it("returns [] when no active signals", () => {
    const r = matchServices({ activeSignals: [], activeDisqualifiers: [] });
    assert.deepEqual(r.included, []);
    assert.deepEqual(r.excluded, []);
  });

  it("single-signal match surfaces the service with that signal", () => {
    const r = matchServices({
      activeSignals: ["bookkeeping_cleanup_needed"],
      activeDisqualifiers: [],
    });
    assert.equal(r.included.length, 1);
    assert.equal(r.included[0].service_id, "bookkeeping_cleanup");
    assert.deepEqual(r.included[0].matched_signals, ["bookkeeping_cleanup_needed"]);
    assert.equal(r.excluded.length, 0);
  });

  it("multi-signal match: score counts matched signals and ranks by it", () => {
    const r = matchServices({
      activeSignals: ["low_margin_visibility", "no_13_week_cash_forecast"],
      activeDisqualifiers: [],
    });
    assert.equal(r.included.length, 1);
    assert.equal(r.included[0].service_id, "fractional_cfo_core");
    assert.equal(r.included[0].score, 2);
    assert.deepEqual(
      r.included[0].matched_signals.sort(),
      ["low_margin_visibility", "no_13_week_cash_forecast"].sort(),
    );
  });

  it("disqualifier excludes a service even when signals match", () => {
    const r = matchServices({
      activeSignals: ["low_margin_visibility"],
      activeDisqualifiers: ["active_tax_default"],
    });
    assert.equal(r.included.length, 0);
    assert.equal(r.excluded.length, 1);
    assert.equal(r.excluded[0].service_id, "fractional_cfo_core");
    assert.ok(r.excluded[0].excluded_by.includes("active_tax_default"));
  });

  it("non-canonical active signals are filtered out", () => {
    // "made_up_signal" is not canonical; even if the catalog listed
    // it the matcher wouldn't fire. The guard happens in signals.js.
    const r = matchServices({
      activeSignals: ["made_up_signal", "low_margin_visibility"],
      activeDisqualifiers: [],
    });
    assert.equal(r.included.length, 1);
    assert.deepEqual(r.included[0].matched_signals, ["low_margin_visibility"]);
  });

  it("ranks by score descending, then by service_id", () => {
    // Fixture: fractional_cfo_core matches 2 signals, bookkeeping
    // matches 1. CFO should come first.
    const r = matchServices({
      activeSignals: ["low_margin_visibility", "no_13_week_cash_forecast", "bookkeeping_cleanup_needed"],
      activeDisqualifiers: [],
    });
    assert.equal(r.included[0].service_id, "fractional_cfo_core");
    assert.equal(r.included[1].service_id, "bookkeeping_cleanup");
  });

  it("accepts an explicit catalog override", () => {
    const mini = [{
      service_id: "x", name: "X",
      signals_relevant: ["low_margin_visibility"],
      when_not_to_recommend: [],
    }];
    const r = matchServices({
      activeSignals: ["low_margin_visibility"],
      activeDisqualifiers: [],
      catalog: mini,
    });
    assert.equal(r.included.length, 1);
    assert.equal(r.included[0].service_id, "x");
  });
});

describe("formatSection7Body", () => {
  it("empty matches → plain 'no services matched' message, no fabricated SM tags", () => {
    const body = formatSection7Body({ included: [], excluded: [] });
    assert.match(body, /No services matched/);
    assert.ok(!body.includes("[SM:"));
  });

  it("included matches carry [SM: service_id, signal=slug] with the first matched signal", () => {
    const matches = {
      included: [{
        service_id: "fractional_cfo_core",
        name: "Fractional CFO",
        problem_solved: "cash viz.",
        matched_signals: ["low_margin_visibility", "no_13_week_cash_forecast"],
        score: 2, excluded: false, excluded_by: [],
        dependencies: ["bookkeeping"], pricing: { note: "retainer" },
      }],
      excluded: [],
    };
    const body = formatSection7Body(matches);
    assert.match(body, /\[SM: fractional_cfo_core, signal=low_margin_visibility\]/);
    assert.match(body, /Additional matched signals: no_13_week_cash_forecast/);
    assert.match(body, /Dependencies: bookkeeping/);
    assert.match(body, /Pricing: retainer/);
  });

  it("excluded matches are shown under a 'Considered but excluded' header", () => {
    const matches = {
      included: [],
      excluded: [{
        service_id: "fractional_cfo_core",
        name: "Fractional CFO",
        matched_signals: ["low_margin_visibility"],
        score: 1, excluded: true, excluded_by: ["active_tax_default"],
        dependencies: [], pricing: null, problem_solved: "x",
      }],
    };
    const body = formatSection7Body(matches);
    assert.match(body, /Considered but excluded/);
    assert.match(body, /excluded by: active_tax_default/);
  });

  it("includes catalog version when provided", () => {
    const body = formatSection7Body({ included: [], excluded: [] }, { catalogVersion: "deadbeef1234" });
    assert.match(body, /Catalog version: `deadbeef1234`/);
  });
});

describe("POST /asksolomon/case/match-services — handleMatchServices", () => {
  const sampleDraftWithSection7 = [
    DRAFT_BANNER,
    "",
    "## Section 1 — Where You Are Now",
    "intro",
    "## Section 2 — Verified Financial Position",
    "fin",
    "## Section 3 — Priority Issues",
    "pri",
    "## Section 4 — 90-Day Commitments",
    "commit",
    "## Section 5 — 6-Month Direction",
    "six",
    "## Section 6 — 12-Month Goals / Reassessment",
    "twelve",
    "## Section 7 — Service Recommendations",
    "_Placeholder._",
    "## Section 8 — Open Questions / Decisions",
    "qs",
  ].join("\n");

  it("401 without x-console-password", async () => {
    const res = await handleMatchServices(post({ contactId: "c1" }, {}), makeEnv(), { checkPassword });
    assert.equal(res.status, 401);
  });

  it("400 without contactId", async () => {
    const res = await handleMatchServices(post({}), makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
  });

  it("400 on invalid mode", async () => {
    const res = await handleMatchServices(post({ contactId: "c1", mode: "nuke" }), makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
  });

  it("400 when contact lacks swot_paid_297", async () => {
    const cap = stubFetch(() => ghlContactRes({ tags: ["swot_paid_47"] }));
    try {
      const res = await handleMatchServices(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
    } finally { cap.restore(); }
  });

  it("400 when no draft present (write mode)", async () => {
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields") && !String(url).includes("/contacts/")) {
        return new Response(JSON.stringify({ customFields: [] }), { status: 200 });
      }
      return ghlContactRes({ customFields: [{ fieldKey: "contact.low_margin_visibility_opp", value: "x" }] });
    });
    try {
      const res = await handleMatchServices(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
    } finally { cap.restore(); }
  });

  it("readonly mode: returns matches without any PUT", async () => {
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields") && !String(url).includes("/contacts/")) {
        return new Response(JSON.stringify({ customFields: [] }), { status: 200 });
      }
      return ghlContactRes({ tags: ["swot_paid_297", "low_margin_visibility_opp"] });
    });
    try {
      const res = await handleMatchServices(
        post({ contactId: "c1", mode: "readonly" }),
        makeEnv(), { checkPassword });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.section_7_updated, false);
      assert.ok(body.matches.included.length >= 1);
      // No PUT in readonly mode.
      for (const c of cap.calls) assert.notEqual(c.method, "PUT");
    } finally { cap.restore(); }
  });

  it("write mode happy path: splices only Section 7 and preserves banner + other sections", async () => {
    let writeBody = null;
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) {
        return new Response(JSON.stringify({ customFields: [] }), { status: 200 });
      }
      if (u.includes("/contacts/") && init?.method === "PUT") {
        writeBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      return ghlContactRes({
        tags: ["swot_paid_297", "low_margin_visibility_opp"],
        customFields: [
          { fieldKey: "contact.swot_growth_plan_draft", value: sampleDraftWithSection7 },
        ],
      });
    });
    try {
      const res = await handleMatchServices(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.section_7_updated, true);
      assert.ok(body.draft.includes(DRAFT_BANNER));
      // Section 7 body got replaced; _Placeholder._ should be gone,
      // and an SM tag should be present.
      assert.ok(!body.draft.includes("_Placeholder._"));
      assert.match(body.draft, /\[SM: fractional_cfo_core/);
      // Section 1's body ("intro") still there (unchanged).
      assert.match(body.draft, /intro/);
      // (Codex P2 on #97) swot_growth_plan_draft AND
      // swot_bga_services_catalog_ref written in one PUT so the audit
      // record stays in sync with the content it describes.
      // (PR 10 / §8) The shared version-history wrapper now also writes
      // swot_bga_version_history in the same PUT so partial writes
      // can't leave the audit log disagreeing with the content.
      assert.equal(writeBody.customFields.length, 3);
      const keys = writeBody.customFields.map((f) => f.key).sort();
      assert.deepEqual(keys, [
        "swot_bga_services_catalog_ref",
        "swot_bga_version_history",
        "swot_growth_plan_draft",
      ]);
    } finally { cap.restore(); }
  });

  it("NEVER writes swot_growth_plan or applies swot_growth_plan_ready or any tag", async () => {
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) {
        return new Response(JSON.stringify({ customFields: [] }), { status: 200 });
      }
      if (u.includes("/contacts/") && init?.method === "PUT") {
        return new Response("", { status: 200 });
      }
      return ghlContactRes({
        tags: ["swot_paid_297", "low_margin_visibility_opp"],
        customFields: [
          { fieldKey: "contact.swot_growth_plan_draft", value: sampleDraftWithSection7 },
        ],
      });
    });
    try {
      await handleMatchServices(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      for (const c of cap.calls) {
        if (c.url.endsWith("/tags")) assert.fail("match-services must not apply any tag");
        if (c.method === "PUT" && c.body) {
          const b = String(c.body);
          assert.ok(!b.includes('"swot_growth_plan"'), "must not touch swot_growth_plan field");
          assert.ok(!b.includes("swot_growth_plan_ready"), "must not reference the _ready tag");
        }
      }
    } finally { cap.restore(); }
  });

  it("surfaces active disqualifiers derived from verified financials", async () => {
    const vf = JSON.stringify([
      { metric_id: "revenue_ttm", value: 400000 }, // triggers revenue_band_below_500k
      { metric_id: "tax_status", value: "in_default" }, // active_tax_default
    ]);
    const cap = stubFetch((url) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) {
        return new Response(JSON.stringify({ customFields: [] }), { status: 200 });
      }
      return ghlContactRes({
        tags: ["swot_paid_297", "low_margin_visibility_opp"],
        customFields: [{ fieldKey: "contact.swot_verified_financials", value: vf }],
      });
    });
    try {
      const res = await handleMatchServices(
        post({ contactId: "c1", mode: "readonly" }),
        makeEnv(), { checkPassword });
      const body = await res.json();
      assert.ok(body.active_disqualifiers.includes("revenue_band_below_500k"));
      assert.ok(body.active_disqualifiers.includes("active_tax_default"));
      // fractional_cfo_core should be excluded under either DQ.
      assert.ok(body.matches.excluded.find((m) => m.service_id === "fractional_cfo_core"));
    } finally { cap.restore(); }
  });

  it("includes catalog_version in the response", async () => {
    const cap = stubFetch((url) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) {
        return new Response(JSON.stringify({ customFields: [] }), { status: 200 });
      }
      return ghlContactRes({ tags: ["swot_paid_297"] });
    });
    try {
      const res = await handleMatchServices(post({ contactId: "c1", mode: "readonly" }), makeEnv(), { checkPassword });
      const body = await res.json();
      assert.ok(typeof body.catalog_version === "string" && body.catalog_version.length > 0);
    } finally { cap.restore(); }
  });
});
