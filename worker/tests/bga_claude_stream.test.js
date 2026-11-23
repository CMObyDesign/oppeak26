// Streamed Claude calls for long BGA outputs (src/bga_copilot/claude_stream.js).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { callClaudeStreamed, readClaudeResponse } from "../src/bga_copilot/claude_stream.js";

const sse = (parts, stop = "end_turn") =>
  [
    'event: message_start\ndata: {"type":"message_start"}\n',
    ...parts.map((t) => `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: t } })}\n`),
    `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"${stop}"}}\n`,
    'event: message_stop\ndata: {"type":"message_stop"}\n',
  ].join("\n");

describe("claude_stream", () => {
  it("sends stream: true and joins the streamed text", async () => {
    let sent;
    const r = await callClaudeStreamed({
      env: { ANTHROPIC_API_KEY: "k" },
      body: { model: "m", max_tokens: 10, messages: [] },
      fetchImpl: async (_u, init) => { sent = JSON.parse(init.body); return new Response(sse(["## Section 1", " — Where"])); },
    });
    assert.equal(sent.stream, true);
    assert.deepEqual(r, { ok: true, text: "## Section 1 — Where", stop_reason: "end_turn" });
  });

  it("reports max_tokens so the caller refuses a cut-off draft", async () => {
    const { stopReason } = await readClaudeResponse(new Response(sse(["partial"], "max_tokens")));
    assert.equal(stopReason, "max_tokens");
  });

  it("still reads a plain JSON response", async () => {
    const r = await readClaudeResponse(new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" })));
    assert.deepEqual(r, { text: "hi", stopReason: "end_turn" });
  });

  it("surfaces API errors", async () => {
    const r = await callClaudeStreamed({ env: { ANTHROPIC_API_KEY: "k" }, body: {}, fetchImpl: async () => new Response("overloaded", { status: 529 }) });
    assert.equal(r.ok, false);
    assert.match(r.error, /529/);
  });
});
