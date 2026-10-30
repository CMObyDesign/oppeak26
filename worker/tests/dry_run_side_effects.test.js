// Regression: an explicit `dry_run: true` on any Solomon handler must
// prevent ALL GHL side effects — writeback, tag application, tracking
// event. The three primitive side-effect functions short-circuit when
// opts.dryRun is true. This test exercises each one directly, with a
// captured fetch so a leaked call would be caught by assertion.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  updateGHLContact,
  addGHLTag,
  fireTrackingEvent,
} from "../src/index.js";
import { makeStubEnv, captureFetch } from "./helpers.js";

describe("dry-run side effects", () => {
  let fetchCapture;

  beforeEach(() => {
    fetchCapture = captureFetch(() =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  afterEach(() => {
    fetchCapture.restore();
  });

  it("updateGHLContact({dryRun:true}) does not call fetch", async () => {
    const env = makeStubEnv();
    const result = await updateGHLContact("xContactId", [{ key: "k", field_value: "v" }], env, { dryRun: true });
    assert.equal(result, true, "dry run should still return a truthy ok");
    assert.equal(fetchCapture.calls.length, 0, "no fetch call allowed in dry run");
  });

  it("addGHLTag({dryRun:true}) does not call fetch", async () => {
    const env = makeStubEnv();
    const result = await addGHLTag("xContactId", ["swot_test"], env, { dryRun: true });
    assert.equal(result, true);
    assert.equal(fetchCapture.calls.length, 0, "no fetch call allowed in dry run");
  });

  it("fireTrackingEvent({dryRun:true}) does not call fetch", async () => {
    const env = makeStubEnv();
    const result = await fireTrackingEvent({ event_type: "report_generated_free", tier: "free" }, env, { dryRun: true });
    assert.equal(fetchCapture.calls.length, 0, "no fetch call allowed in dry run");
    assert.ok(result && result.skipped === true, "fireTrackingEvent should report skipped");
    assert.ok(result.dryRun === true, "fireTrackingEvent should flag dryRun in its result");
  });

  it("without dryRun, the same calls DO reach fetch (control case)", async () => {
    const env = makeStubEnv();
    await updateGHLContact("xContactId", [{ key: "k", field_value: "v" }], env);
    assert.equal(fetchCapture.calls.length, 1, "live mode must call fetch exactly once");
    assert.match(fetchCapture.calls[0].url, /\/contacts\/xContactId$/,
      "URL should target the contact");
    assert.equal(fetchCapture.calls[0].init?.method, "PUT");
  });

  it("without dryRun, addGHLTag reaches fetch", async () => {
    const env = makeStubEnv();
    await addGHLTag("xContactId", ["swot_test"], env);
    assert.equal(fetchCapture.calls.length, 1);
    assert.match(fetchCapture.calls[0].url, /\/contacts\/xContactId\/tags$/);
    assert.equal(fetchCapture.calls[0].init?.method, "POST");
  });

  it("without dryRun, fireTrackingEvent reaches fetch", async () => {
    const env = makeStubEnv();
    await fireTrackingEvent({ event_type: "report_generated_free", tier: "free" }, env);
    assert.equal(fetchCapture.calls.length, 1,
      "live mode must send one tracking POST");
  });
});

// 2026-10-30: Liz asked for flat answer_1..answer_N keys on the HL
// tracking webhook body so each owner response is directly readable
// in HL's "Last Execution" panel without parsing the nested answers
// array. Flatten alongside the existing array (backward compat).
describe("flattenAnswersForTracking — unmapped tier (indexed fallback)", () => {
  // No tier → falls back to array-index behavior. This path remains
  // for paid_47 / paid_297 / console callers where no canonical
  // position map exists.
  it("returns answer_1..answer_N keyed by submission order when no tier is supplied", async () => {
    const { flattenAnswersForTracking } = await import("../src/index.js");
    const out = flattenAnswersForTracking([
      { question: "Q1", answer: "Service-based" },
      { question: "Q2", answer: "Local presence" },
      { question: "Q3", answer: "Construction" },
    ]);
    assert.deepEqual(out, {
      answer_1: "Service-based",
      answer_2: "Local presence",
      answer_3: "Construction",
    });
  });

  it("skips empty / null / whitespace entries rather than echoing ''", async () => {
    const { flattenAnswersForTracking } = await import("../src/index.js");
    const out = flattenAnswersForTracking([
      { question: "Q1", answer: "ok" },
      { question: "Q2", answer: "" },
      { question: "Q3", answer: null },
      { question: "Q4", answer: "   " },
      { question: "Q5", answer: "also ok" },
    ]);
    // Position-preserving across skipped entries: an entry at
    // array index 4 still produces answer_5 so an un-tiered caller's
    // numbering survives empty slots.
    assert.deepEqual(out, { answer_1: "ok", answer_5: "also ok" });
  });

  it("stringifies non-string values but drops undefined", async () => {
    const { flattenAnswersForTracking } = await import("../src/index.js");
    const out = flattenAnswersForTracking([
      { question: "Q1", answer: 25000 },
      { question: "Q2", value: "legacy value key supported" },
      { question: "Q3" }, // no answer at all → skipped
    ]);
    assert.deepEqual(out, {
      answer_1: "25000",
      answer_2: "legacy value key supported",
    });
  });

  it("returns {} for a non-array (bad input guard)", async () => {
    const { flattenAnswersForTracking } = await import("../src/index.js");
    assert.deepEqual(flattenAnswersForTracking(null), {});
    assert.deepEqual(flattenAnswersForTracking(undefined), {});
    assert.deepEqual(flattenAnswersForTracking("oops"), {});
    assert.deepEqual(flattenAnswersForTracking({}), {});
  });

  it("spread into a tracking payload sits alongside the nested answers array", async () => {
    const { flattenAnswersForTracking } = await import("../src/index.js");
    const answers = [
      { question: "Q1", answer: "A" },
      { question: "Q2", answer: "B" },
    ];
    const body = { event_type: "report_generated_free", tier: "free", answers, ...flattenAnswersForTracking(answers) };
    // Nested array preserved for backward-compat consumers.
    assert.equal(body.answers.length, 2);
    // Flat answer_N keys added (no tier → indexed fallback).
    assert.equal(body.answer_1, "A");
    assert.equal(body.answer_2, "B");
  });
});

// Codex P1 on #170 regression bar. The free-tier intake has a
// canonical Q1-Q11 order; the answers array coming out of
// answersFromContactFields does NOT preserve that order (it drops
// blank fields, interleaves non-Solomon CRM fields, and follows
// GHL's own array iteration order). A naive index-based flatten
// would mis-slot Q4's response into `answer_3` if Q3 was blank.
// Fix: resolve the position from a tier-specific map keyed by HL
// field id, which answersFromContactFields now carries on each
// answer as `_field_id`.
describe("flattenAnswersForTracking — free tier (stable position map)", () => {
  it("maps each free-tier answer to its canonical Q1-Q11 slot by HL field id", async () => {
    const { flattenAnswersForTracking } = await import("../src/index.js");
    // Simulate answersFromContactFields output: full 11-answer intake,
    // deliberately shuffled so array index != Q position.
    const answers = [
      { _field_id: "qKRvCyjprebbK75tC05h", question: "Q11", answer: "A11" },
      { _field_id: "5VWVNRrQYcLqXhckh4f4", question: "Q1",  answer: "A1"  },
      { _field_id: "nbPL6APmjrjr43J6urVb", question: "Q3",  answer: "A3"  },
      { _field_id: "OyQjw4nGNHJYADsq5ggg", question: "Q4",  answer: "A4"  },
      { _field_id: "8sSKohKtQZZzJEtM2ju0", question: "Q5",  answer: "A5"  },
      { _field_id: "nCRqWH0x1sdJIgUPDr2E", question: "Q2",  answer: "A2"  },
      { _field_id: "deItnw0p1H7sO1okRjGS", question: "Q6",  answer: "A6"  },
      { _field_id: "hV9yij5uFitztZzanSaa", question: "Q7",  answer: "A7"  },
      { _field_id: "ngBePHf4iKPhaHm2OtSv", question: "Q8",  answer: "A8"  },
      { _field_id: "cvuAgfuL94eBahOrnTY0", question: "Q9",  answer: "A9"  },
      { _field_id: "cdlV9zqJxztcxfXgD4J0", question: "Q10", answer: "A10" },
    ];
    const out = flattenAnswersForTracking(answers, { tier: "free" });
    assert.deepEqual(out, {
      answer_1: "A1",   answer_2: "A2",   answer_3: "A3",   answer_4: "A4",
      answer_5: "A5",   answer_6: "A6",   answer_7: "A7",   answer_8: "A8",
      answer_9: "A9",   answer_10: "A10", answer_11: "A11",
    });
  });

  it("preserves correct slots when a middle question is skipped (the exact Codex P1 case)", async () => {
    const { flattenAnswersForTracking } = await import("../src/index.js");
    // Q3 is blank, so answersFromContactFields drops it entirely.
    // A naive index-based flatten would put Q4's answer under
    // `answer_3`. The position map prevents that.
    const answers = [
      { _field_id: "5VWVNRrQYcLqXhckh4f4", question: "Q1", answer: "biz-type" },
      { _field_id: "nCRqWH0x1sdJIgUPDr2E", question: "Q2", answer: "reach" },
      // Q3 skipped — answersFromContactFields filtered it out
      { _field_id: "OyQjw4nGNHJYADsq5ggg", question: "Q4", answer: "debt" },
      { _field_id: "8sSKohKtQZZzJEtM2ju0", question: "Q5", answer: "basis" },
    ];
    const out = flattenAnswersForTracking(answers, { tier: "free" });
    // Critical: Q4's answer must land at answer_4, NOT answer_3.
    assert.equal(out.answer_1, "biz-type");
    assert.equal(out.answer_2, "reach");
    assert.equal(out.answer_3, undefined, "answer_3 must stay unset when Q3 was skipped");
    assert.equal(out.answer_4, "debt");
    assert.equal(out.answer_5, "basis");
  });

  it("emits unmapped_<i> for a tier-mapped answer missing _field_id (safer than mis-slotting)", async () => {
    const { flattenAnswersForTracking } = await import("../src/index.js");
    const answers = [
      { _field_id: "5VWVNRrQYcLqXhckh4f4", question: "Q1", answer: "biz-type" },
      { question: "someQ", answer: "orphan — no field id" },
      { _field_id: "unknown_id_in_HL",     question: "QX", answer: "stranger field" },
    ];
    const out = flattenAnswersForTracking(answers, { tier: "free" });
    assert.equal(out.answer_1, "biz-type");
    // Neither orphan lands in an answer_N slot; both surface as
    // unmapped_<index> so HL automation can see they exist but will
    // never read them as Q1-Q11 responses.
    assert.equal(out.unmapped_2, "orphan — no field id");
    assert.equal(out.unmapped_3, "stranger field");
  });

  it("un-mapped tier (e.g. paid_47) falls back to indexed answer_N for backward compat", async () => {
    const { flattenAnswersForTracking } = await import("../src/index.js");
    const answers = [
      { question: "Q1", answer: "A" },
      { question: "Q2", answer: "B" },
    ];
    // paid_47 has no position map (variable-shape intake);
    // behavior is the same as the no-tier call.
    const out = flattenAnswersForTracking(answers, { tier: "paid_47" });
    assert.deepEqual(out, { answer_1: "A", answer_2: "B" });
  });
});
