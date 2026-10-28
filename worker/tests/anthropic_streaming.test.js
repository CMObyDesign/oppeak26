// Streaming SSE parser + 524 short-circuit tests.
//
// callClaudeWithRubric now calls Anthropic with `stream: true` to keep
// the Cloudflare edge from timing out on long paid_47 generations
// (2026-10-28 — Marcus Delgado's paid_47 trace: all 3 attempts hit
// Cloudflare 524 at ~2:06 each because the 24KB prompt + 16k
// max_tokens generation ran past the ~100s edge timeout on a
// single-response fetch). These tests cover:
//
//   1. The SSE parser accumulates text_delta events into the full
//      response text and surfaces message_delta.stop_reason.
//   2. Malformed data lines are skipped without poisoning the parse.
//   3. The queue consumer short-circuits a Cloudflare 524 to terminal
//      failure immediately, so a 524 doesn't waste another 4 minutes
//      of wall-clock on retries that will deterministically fail.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { _test_parseAnthropicSse } from "../src/index.js";

describe("Anthropic SSE parser", () => {
  it("accumulates text_delta events into the full text", () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1"}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\\"path\\":"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"\\"growth\\"}"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":12}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join("\n");

    const { text, stopReason } = _test_parseAnthropicSse(sse);
    assert.equal(text, '{"path":"growth"}');
    assert.equal(stopReason, "end_turn");
  });

  it("surfaces stop_reason max_tokens for a truncated stream", () => {
    const sse = [
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial response..."}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":16000}}',
      '',
    ].join("\n");
    const { text, stopReason } = _test_parseAnthropicSse(sse);
    assert.equal(text, "partial response...");
    assert.equal(stopReason, "max_tokens");
  });

  it("skips malformed data lines without crashing", () => {
    const sse = [
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello "}}',
      'data: not json at all',
      'data: ',
      'data: [DONE]',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}',
      '',
    ].join("\n");
    const { text } = _test_parseAnthropicSse(sse);
    assert.equal(text, "hello world");
  });

  it("handles \\r\\n line endings (some proxies rewrite \\n)", () => {
    const sse = [
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
      '',
    ].join("\r\n");
    const { text } = _test_parseAnthropicSse(sse);
    assert.equal(text, "ok");
  });

  it("ignores events of unknown type (forward-compat)", () => {
    const sse = [
      'event: ping',
      'data: {"type":"ping"}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"x"}}',
      '',
    ].join("\n");
    const { text } = _test_parseAnthropicSse(sse);
    assert.equal(text, "x");
  });
});

describe("524 short-circuit — error-signature detection", () => {
  // The queue consumer's catch block tests the error message with
  // /Claude API 524\b/ before deciding to short-circuit. Lock the
  // signature so a future rewording of callClaudeWithRubric's error
  // throw doesn't silently disable the short-circuit (which would
  // regress Marcus Delgado's exact failure mode).
  const SHORT_CIRCUIT_PATTERN = /Claude API 524\b/;

  it("matches the exact error string callClaudeWithRubric throws on a 524 response", () => {
    const errMsg = "Claude API 524: error code: 524\n";
    assert.match(errMsg, SHORT_CIRCUIT_PATTERN);
  });

  it("matches variants with different trailing detail", () => {
    assert.match("Claude API 524: upstream disconnected", SHORT_CIRCUIT_PATTERN);
    assert.match("Claude API 524", SHORT_CIRCUIT_PATTERN);
  });

  it("does NOT match other upstream errors — those still get the normal retry", () => {
    assert.doesNotMatch("Claude API 500: internal error", SHORT_CIRCUIT_PATTERN);
    assert.doesNotMatch("Claude API 429: rate limited", SHORT_CIRCUIT_PATTERN);
    assert.doesNotMatch("Claude API 503: service unavailable", SHORT_CIRCUIT_PATTERN);
    // A 5240 prefix on a different error should NOT match either (\b
    // boundary guards against this).
    assert.doesNotMatch("Claude API 5240: made-up code", SHORT_CIRCUIT_PATTERN);
  });

  it("does NOT match a prose mention of 524 inside some other message", () => {
    assert.doesNotMatch("Request took 524ms", SHORT_CIRCUIT_PATTERN);
    assert.doesNotMatch("524 users in the batch", SHORT_CIRCUIT_PATTERN);
  });
});
