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
