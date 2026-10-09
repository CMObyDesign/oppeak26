// BGA Copilot — extract_call_decisions tests (PR 9).
//
// Pins:
//   - Extract: READ-ONLY, 11-key JSON output, rejects truncation /
//     malformed / unknown keys / non-array values.
//   - Confirm: writes ONLY swot_bga_decisions + swot_bga_services_selected
//     in one atomic PUT; no tags; rejects unknown service_ids.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  CALL_DECISIONS_SECTIONS,
  buildCallDecisionsSystemPrompt,
  buildCallDecisionsUserPrompt,
  parseAndValidateExtracted,
  handleExtractCallDecisions,
  handleConfirmCallDecisions,
} from "../src/bga_copilot/call_decisions.js";
import { _resetCatalogCacheForTests } from "../src/ghl_catalog.js";
import { _setCatalogForTests } from "../src/bga_copilot/services_catalog.js";

const FIXTURE_CATALOG = [
  { service_id: "fractional_cfo_core", name: "CFO Core", signals_relevant: [], when_not_to_recommend: [] },
  { service_id: "bookkeeping_cleanup", name: "Bookkeeping", signals_relevant: [], when_not_to_recommend: [] },
];

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
function ghlContactRes({ tags = ["swot_paid_297"] } = {}) {
  return new Response(
    JSON.stringify({ contact: { id: "c1", tags, customFields: [] } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
function claudeRes(text, { stop_reason = "end_turn" } = {}) {
  return new Response(JSON.stringify({ content: [{ text }], stop_reason }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

function sampleGoodRecord() {
  return {
    priorities_confirmed: ["Collect on AR_over_90"],
    priorities_changed: [],
    client_corrections: ["Owner clarified revenue_ttm figure is 2.4M not 2.2M"],
    ninety_day_commitments: ["Close monthly books by day 7"],
    six_month_direction: ["Build 13-week cash forecast"],
    twelve_month_goals: ["Reassess hiring plan Q3"],
    next_steps: ["Miguel sends intake letter"],
    services_discussed: ["fractional_cfo_core", "bookkeeping_cleanup"],
    services_selected: ["fractional_cfo_core"],
    services_declined_or_deferred: ["bookkeeping_cleanup"],
    follow_up_needed: [],
  };
}

beforeEach(() => { _resetCatalogCacheForTests(); _setCatalogForTests(FIXTURE_CATALOG); });

describe("CALL_DECISIONS_SECTIONS + prompts", () => {
  it("has exactly 11 section slugs in spec §4.7 order", () => {
    assert.deepEqual([...CALL_DECISIONS_SECTIONS], [
      "priorities_confirmed",
      "priorities_changed",
      "client_corrections",
      "ninety_day_commitments",
      "six_month_direction",
      "twelve_month_goals",
      "next_steps",
      "services_discussed",
      "services_selected",
      "services_declined_or_deferred",
      "follow_up_needed",
    ]);
  });

  it("system prompt names every section", () => {
    const p = buildCallDecisionsSystemPrompt();
    for (const slug of CALL_DECISIONS_SECTIONS) assert.ok(p.includes(slug), `missing: ${slug}`);
  });

  it("user prompt surfaces notes + catalog service_ids", () => {
    const u = buildCallDecisionsUserPrompt({
      notes: "owner agreed to hire a bookkeeper",
      catalogServiceIds: ["fractional_cfo_core", "bookkeeping_cleanup"],
    });
    assert.match(u, /owner agreed/);
    assert.match(u, /fractional_cfo_core/);
    assert.match(u, /bookkeeping_cleanup/);
  });

  it("user prompt tells the model to leave services_* empty when catalog is empty", () => {
    const u = buildCallDecisionsUserPrompt({ notes: "x", catalogServiceIds: [] });
    assert.match(u, /catalog empty/);
  });
});

describe("parseAndValidateExtracted", () => {
  it("accepts a clean 11-key JSON object", () => {
    const r = parseAndValidateExtracted(JSON.stringify(sampleGoodRecord()), "end_turn");
    assert.equal(r.ok, true);
    for (const slug of CALL_DECISIONS_SECTIONS) assert.ok(Array.isArray(r.record[slug]));
  });

  it("tolerates a ```json fence around the output", () => {
    const text = "```json\n" + JSON.stringify(sampleGoodRecord()) + "\n```";
    const r = parseAndValidateExtracted(text, "end_turn");
    assert.equal(r.ok, true);
  });

  it("rejects stop_reason=max_tokens", () => {
    const r = parseAndValidateExtracted(JSON.stringify(sampleGoodRecord()), "max_tokens");
    assert.equal(r.ok, false);
    assert.match(r.error, /max_tokens/);
  });

  it("rejects non-JSON", () => {
    const r = parseAndValidateExtracted("not json at all", "end_turn");
    assert.equal(r.ok, false);
    assert.match(r.error, /not valid JSON/);
  });

  it("rejects missing section", () => {
    const bad = { ...sampleGoodRecord() }; delete bad.next_steps;
    const r = parseAndValidateExtracted(JSON.stringify(bad), "end_turn");
    assert.equal(r.ok, false);
    assert.match(r.error, /missing section: next_steps/);
  });

  it("rejects non-array section value", () => {
    const bad = { ...sampleGoodRecord(), next_steps: "not an array" };
    const r = parseAndValidateExtracted(JSON.stringify(bad), "end_turn");
    assert.equal(r.ok, false);
    assert.match(r.error, /not an array/);
  });

  it("rejects non-string items", () => {
    const bad = { ...sampleGoodRecord(), next_steps: [42, "ok"] };
    const r = parseAndValidateExtracted(JSON.stringify(bad), "end_turn");
    assert.equal(r.ok, false);
    assert.match(r.error, /non-string item/);
  });

  it("rejects unknown keys", () => {
    const bad = { ...sampleGoodRecord(), bonus_section: [] };
    const r = parseAndValidateExtracted(JSON.stringify(bad), "end_turn");
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown keys: bonus_section/);
  });

  it("trims whitespace and drops empty items", () => {
    const noisy = { ...sampleGoodRecord(), priorities_confirmed: ["  a  ", "", "   "] };
    const r = parseAndValidateExtracted(JSON.stringify(noisy), "end_turn");
    assert.deepEqual(r.record.priorities_confirmed, ["a"]);
  });
});

describe("POST /asksolomon/case/extract-call-decisions — handleExtractCallDecisions", () => {
  it("401 without x-console-password", async () => {
    const res = await handleExtractCallDecisions(post({ contactId: "c1", notes: "x" }, {}), makeEnv(), { checkPassword });
    assert.equal(res.status, 401);
  });

  it("400 without contactId or notes", async () => {
    let res = await handleExtractCallDecisions(post({ notes: "x" }), makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
    res = await handleExtractCallDecisions(post({ contactId: "c1" }), makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
  });

  it("400 when contact lacks swot_paid_297", async () => {
    const cap = stubFetch(() => ghlContactRes({ tags: ["swot_paid_47"] }));
    try {
      const res = await handleExtractCallDecisions(
        post({ contactId: "c1", notes: "stuff" }),
        makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
    } finally { cap.restore(); }
  });

  it("502 on malformed Claude output; NO PUT, NO tag", async () => {
    let putFired = false, tagFired = false;
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) return claudeRes("not json");
      if (u.endsWith("/tags")) { tagFired = true; return new Response("", { status: 200 }); }
      if (u.includes("/contacts/") && init?.method === "PUT") { putFired = true; return new Response("", { status: 200 }); }
      return ghlContactRes();
    });
    try {
      const res = await handleExtractCallDecisions(
        post({ contactId: "c1", notes: "stuff" }),
        makeEnv(), { checkPassword });
      assert.equal(res.status, 502);
      assert.equal(putFired, false);
      assert.equal(tagFired, false);
    } finally { cap.restore(); }
  });

  it("happy path is READ-ONLY: no PUT, no tag, response persisted=false", async () => {
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) return claudeRes(JSON.stringify(sampleGoodRecord()));
      if (u.includes("/contacts/") && init?.method === "PUT") assert.fail("extract must not PUT");
      if (u.endsWith("/tags")) assert.fail("extract must not apply any tag");
      return ghlContactRes();
    });
    try {
      const res = await handleExtractCallDecisions(
        post({ contactId: "c1", notes: "owner agreed to hire bookkeeper" }),
        makeEnv(), { checkPassword });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.persisted, false);
      assert.ok(body.record.priorities_confirmed);
      assert.ok(Array.isArray(body.catalog_service_ids));
      assert.ok(body.catalog_service_ids.includes("fractional_cfo_core"));
    } finally { cap.restore(); }
  });
});

describe("POST /asksolomon/case/confirm-call-decisions — handleConfirmCallDecisions", () => {
  it("401 without x-console-password", async () => {
    const res = await handleConfirmCallDecisions(
      post({ contactId: "c1", decisions: sampleGoodRecord() }, {}),
      makeEnv(), { checkPassword });
    assert.equal(res.status, 401);
  });

  it("400 without contactId / decisions / wrong shape", async () => {
    let res = await handleConfirmCallDecisions(
      post({ decisions: sampleGoodRecord() }),
      makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
    res = await handleConfirmCallDecisions(
      post({ contactId: "c1" }),
      makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
    res = await handleConfirmCallDecisions(
      post({ contactId: "c1", decisions: ["array not object"] }),
      makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
  });

  it("400 when a section is missing or wrong type", async () => {
    const bad = { ...sampleGoodRecord() }; delete bad.follow_up_needed;
    const res = await handleConfirmCallDecisions(
      post({ contactId: "c1", decisions: bad }),
      makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /missing section: follow_up_needed/);
  });

  it("400 on unknown service_id in services_selected", async () => {
    const cap = stubFetch(() => ghlContactRes());
    try {
      const res = await handleConfirmCallDecisions(
        post({
          contactId: "c1",
          decisions: sampleGoodRecord(),
          services_selected: ["not_in_catalog"],
        }),
        makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.match(body.error, /unknown service_id/);
    } finally { cap.restore(); }
  });

  it("(Codex P2 on #100) happy path: writes decisions as a flat array and services_selected with status/reason", async () => {
    let writeBody = null;
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.endsWith("/tags")) assert.fail("confirm must not apply any tag");
      if (u.includes("/contacts/") && init?.method === "PUT") {
        writeBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      return ghlContactRes();
    });
    try {
      const res = await handleConfirmCallDecisions(
        post({
          contactId: "c1",
          decisions: sampleGoodRecord(),
          services_selected: ["fractional_cfo_core"],
        }),
        makeEnv(), { checkPassword });
      assert.equal(res.status, 200);
      // Both fields in one PUT.
      assert.ok(writeBody && Array.isArray(writeBody.customFields));
      const keys = writeBody.customFields.map((f) => f.key).sort();
      assert.deepEqual(keys, ["swot_bga_decisions", "swot_bga_services_selected"]);

      // Finding 1: swot_bga_decisions is a FLAT ARRAY of
      // { at, category, text } records so case_load's
      // countJsonArrayItems counts it correctly on reload.
      const decField = writeBody.customFields.find((f) => f.key === "swot_bga_decisions");
      const decisionsArr = JSON.parse(decField.field_value);
      assert.ok(Array.isArray(decisionsArr), "swot_bga_decisions must be an array");
      assert.ok(decisionsArr.length > 0);
      for (const d of decisionsArr) {
        assert.ok(typeof d.at === "string" && /^\d{4}-/.test(d.at), "each entry has an ISO timestamp");
        assert.ok(typeof d.category === "string");
        assert.ok(typeof d.text === "string" && d.text.length > 0);
      }
      // Entries cover all non-empty sections from the record.
      assert.ok(decisionsArr.find((d) => d.category === "priorities_confirmed" && d.text === "Collect on AR_over_90"));
      assert.ok(decisionsArr.find((d) => d.category === "ninety_day_commitments" && d.text === "Close monthly books by day 7"));

      // Finding 2: swot_bga_services_selected is an array of
      // { service_id, status, reason }. Selected and
      // declined_or_deferred both land here with distinct status.
      const selField = writeBody.customFields.find((f) => f.key === "swot_bga_services_selected");
      const selArr = JSON.parse(selField.field_value);
      assert.ok(Array.isArray(selArr));
      // The sample record has fractional_cfo_core selected and
      // bookkeeping_cleanup under services_declined_or_deferred.
      const selected = selArr.filter((e) => e.status === "selected").map((e) => e.service_id);
      const declined = selArr.filter((e) => e.status === "declined_or_deferred").map((e) => e.service_id);
      assert.deepEqual(selected, ["fractional_cfo_core"]);
      assert.deepEqual(declined, ["bookkeeping_cleanup"]);
      // Every entry carries the full {service_id, status, reason} shape.
      for (const e of selArr) {
        assert.ok(typeof e.service_id === "string");
        assert.ok(e.status === "selected" || e.status === "declined_or_deferred");
        assert.ok(typeof e.reason === "string");
      }
    } finally { cap.restore(); }
  });

  it("NEVER writes swot_growth_plan or swot_growth_plan_ready; NO tag", async () => {
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("/contacts/") && init?.method === "PUT") return new Response("", { status: 200 });
      return ghlContactRes();
    });
    try {
      await handleConfirmCallDecisions(
        post({
          contactId: "c1",
          decisions: sampleGoodRecord(),
          services_selected: ["fractional_cfo_core"],
        }),
        makeEnv(), { checkPassword });
      for (const c of cap.calls) {
        if (c.url.endsWith("/tags")) assert.fail("confirm must not apply any tag");
        if (c.method === "PUT" && c.body) {
          const b = String(c.body);
          assert.ok(!b.includes('"swot_growth_plan"'), "must not touch swot_growth_plan field");
          assert.ok(!b.includes("swot_growth_plan_ready"), "must not touch the _ready tag");
          assert.ok(!b.includes('"swot_growth_plan_draft"'), "must not touch swot_growth_plan_draft field");
        }
      }
    } finally { cap.restore(); }
  });

  it("services_selected dedupes while preserving first-seen order (within selected status)", async () => {
    let writeBody = null;
    const cap = stubFetch((url, init) => {
      if (String(url).includes("/contacts/") && init?.method === "PUT") {
        writeBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      return ghlContactRes();
    });
    try {
      // Record's services_declined_or_deferred is empty here so we
      // only check the "selected" bucket; dup rules are the same.
      const rec = sampleGoodRecord();
      rec.services_declined_or_deferred = [];
      await handleConfirmCallDecisions(
        post({
          contactId: "c1",
          decisions: rec,
          services_selected: [
            "fractional_cfo_core", "bookkeeping_cleanup",
            "fractional_cfo_core", // dup
            "bookkeeping_cleanup", // dup
          ],
        }),
        makeEnv(), { checkPassword });
      const selArr = JSON.parse(
        writeBody.customFields.find((f) => f.key === "swot_bga_services_selected").field_value,
      );
      const selected = selArr.filter((e) => e.status === "selected").map((e) => e.service_id);
      assert.deepEqual(selected, ["fractional_cfo_core", "bookkeeping_cleanup"]);
    } finally { cap.restore(); }
  });

  it("falls back to decisions.services_selected when body-level is missing", async () => {
    let writeBody = null;
    const cap = stubFetch((url, init) => {
      if (String(url).includes("/contacts/") && init?.method === "PUT") {
        writeBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      return ghlContactRes();
    });
    try {
      // No body.services_selected — handler must use the record's.
      await handleConfirmCallDecisions(
        post({ contactId: "c1", decisions: sampleGoodRecord() }),
        makeEnv(), { checkPassword });
      const selArr = JSON.parse(
        writeBody.customFields.find((f) => f.key === "swot_bga_services_selected").field_value,
      );
      const selected = selArr.filter((e) => e.status === "selected").map((e) => e.service_id);
      assert.deepEqual(selected, ["fractional_cfo_core"]);
    } finally { cap.restore(); }
  });

  it("(Codex P2 on #100) a service in BOTH selected and declined_or_deferred lands only once, with selected winning", async () => {
    let writeBody = null;
    const cap = stubFetch((url, init) => {
      if (String(url).includes("/contacts/") && init?.method === "PUT") {
        writeBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      return ghlContactRes();
    });
    try {
      const rec = sampleGoodRecord();
      // Overlap: fractional_cfo_core selected AND listed as declined.
      rec.services_declined_or_deferred = ["fractional_cfo_core", "bookkeeping_cleanup"];
      await handleConfirmCallDecisions(
        post({ contactId: "c1", decisions: rec, services_selected: ["fractional_cfo_core"] }),
        makeEnv(), { checkPassword });
      const selArr = JSON.parse(
        writeBody.customFields.find((f) => f.key === "swot_bga_services_selected").field_value,
      );
      // fractional_cfo_core appears exactly once with status=selected.
      const fract = selArr.filter((e) => e.service_id === "fractional_cfo_core");
      assert.equal(fract.length, 1);
      assert.equal(fract[0].status, "selected");
      // bookkeeping_cleanup appears once with declined_or_deferred.
      const book = selArr.filter((e) => e.service_id === "bookkeeping_cleanup");
      assert.equal(book.length, 1);
      assert.equal(book[0].status, "declined_or_deferred");
    } finally { cap.restore(); }
  });

  it("(Codex P2 on #100) rejects an unknown service_id in services_declined_or_deferred", async () => {
    const cap = stubFetch(() => ghlContactRes());
    try {
      const rec = sampleGoodRecord();
      rec.services_declined_or_deferred = ["not_in_catalog"];
      const res = await handleConfirmCallDecisions(
        post({ contactId: "c1", decisions: rec, services_selected: ["fractional_cfo_core"] }),
        makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
      const b = await res.json();
      assert.match(b.error, /services_declined_or_deferred contains unknown service_id/);
    } finally { cap.restore(); }
  });

  it("(Codex P2 on #100) response carries both decisions_stored (array) and services_selected (entries)", async () => {
    const cap = stubFetch((url, init) => {
      if (String(url).includes("/contacts/") && init?.method === "PUT") return new Response("", { status: 200 });
      return ghlContactRes();
    });
    try {
      const res = await handleConfirmCallDecisions(
        post({ contactId: "c1", decisions: sampleGoodRecord(), services_selected: ["fractional_cfo_core"] }),
        makeEnv(), { checkPassword });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.decisions_stored));
      assert.ok(body.decisions_stored.length > 0);
      assert.ok(Array.isArray(body.services_selected));
      assert.ok(body.services_selected.every((e) => typeof e.service_id === "string" && typeof e.status === "string"));
      // Record (per-category view) still returned for UI continuity.
      assert.ok(body.decisions && typeof body.decisions === "object");
    } finally { cap.restore(); }
  });
});
