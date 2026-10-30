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
describe("flattenAnswersForTracking", () => {
  // Dynamic import so the helper picks up this test file's own
  // re-export surface rather than requiring a top-level export change.
  it("returns answer_1..answer_N keyed by submission order", async () => {
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
    // Position-preserving: Q5 is still answer_5 so Liz can
    // cross-reference by number without recalculating indices.
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
    // Flat answer_N keys added.
    assert.equal(body.answer_1, "A");
    assert.equal(body.answer_2, "B");
  });
});
