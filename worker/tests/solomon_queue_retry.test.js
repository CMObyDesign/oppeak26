// Regression lock for the Codex P1 follow-up on #154: the Queue
// consumer must (a) throw on non-final attempts so Queues retries,
// (b) swallow the error on the final attempt and apply the
// swot|deliveryfailed terminal-failure signal, and (c) ack malformed
// payloads instead of looping forever.
//
// This test does NOT drive the full generation path — the Claude call,
// canonical write, and GHL writeback are exercised by their own tests.
// It focuses only on the retry + terminal-failure surface Codex flagged.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { handleSolomonQueueMessage } from "../src/index.js";
import { makeStubEnv, captureFetch } from "./helpers.js";

function makeMessage({ body, attempt }) {
  const ackCalls = [];
  return {
    body,
    attempt,
    attempts: attempt, // Queues passes both names across runtime versions
    ack: () => { ackCalls.push(Date.now()); },
    retry: () => { throw new Error("test should not call message.retry() — the consumer uses throw-to-retry"); },
    _ackCalls: ackCalls,
  };
}

describe("solomon-queue consumer (Codex P1 regression lock)", () => {
  let fetchCapture;

  beforeEach(() => {
    // Default: every GHL fetch returns 404 so the consumer path fails
    // immediately with "contact not found". Individual tests can override.
    fetchCapture = captureFetch((url) => {
      // Return 404 for the contact lookup; return 200 OK for tag writes
      // (so the terminal-failure branch's addGHLTag call doesn't itself
      // throw and mask the behavior we're testing).
      const s = String(url);
      if (s.includes("/contacts/") && !s.includes("/tags")) {
        return new Response(JSON.stringify({ contact: null }), { status: 404 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
  });

  afterEach(() => {
    fetchCapture.restore();
  });

  it("ACKs a malformed payload rather than looping forever", async () => {
    const env = makeStubEnv();
    // Missing contactId AND tier — the consumer's first guard.
    const msg = makeMessage({ body: { foo: "bar" }, attempt: 1 });
    await assert.doesNotReject(() => handleSolomonQueueMessage(msg, env));
    assert.equal(msg._ackCalls.length, 1, "malformed payload must be acked, not retried");
    // No fetch should have fired — the guard bails before any GHL calls.
    assert.equal(fetchCapture.calls.length, 0, "malformed payload must not call GHL");
  });

  it("THROWS on a non-final attempt so Queues retries", async () => {
    const env = makeStubEnv();
    const msg = makeMessage({
      body: { version: 1, contactId: "test-contact", tier: "paid_47", idemPath: "idem/test.json" },
      attempt: 1,
    });
    await assert.rejects(
      () => handleSolomonQueueMessage(msg, env),
      /contact test-contact not found/i,
      "non-final attempt must throw so the Queues runtime retries"
    );
    assert.equal(msg._ackCalls.length, 0, "non-final attempt must not ack");
  });

  it("ACKs + applies swot|deliveryfailed on the FINAL attempt", async () => {
    const env = makeStubEnv();
    const msg = makeMessage({
      body: { version: 1, contactId: "test-contact", tier: "paid_47", idemPath: "idem/test.json" },
      attempt: 3, // == maxAttempts, so isFinalAttempt is true
    });
    // Must NOT throw — Codex P1: a throw here would send the message to
    // the DLQ (which the Worker doesn't consume), losing the terminal-
    // failure signal that this test is specifically locking.
    await assert.doesNotReject(() => handleSolomonQueueMessage(msg, env));
    assert.equal(msg._ackCalls.length, 1, "final attempt must ack even on failure");

    // Verify the swot|deliveryfailed tag write actually fired. The GHL
    // tags endpoint is POST /contacts/{id}/tags.
    const tagWrite = fetchCapture.calls.find((c) =>
      c.url.includes(`/contacts/test-contact/tags`) &&
      c.init?.method === "POST"
    );
    assert.ok(tagWrite, "swot|deliveryfailed tag write must fire on terminal failure");
    const body = JSON.parse(tagWrite.init.body);
    assert.ok(
      Array.isArray(body.tags) && body.tags.includes("swot|deliveryfailed"),
      "terminal-failure tag payload must include swot|deliveryfailed"
    );
  });
});
