// Shared helpers for Solomon regression tests. All tests use node:test and
// import pure/testable units from `../src/index.js` via the named-exports
// block appended to that file.
//
// No real network, no real GHL, no real Claude. If a test needs Claude's
// output shape it installs a stub via `makeStubEnv({ claudeStub })` — the
// production code looks for `env.__CLAUDE_STUB__` as a test-only escape
// hatch (callClaude / callClaudeWithRubric). See the comment in those two
// functions for the contract.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadFixture(name) {
  const p = path.join(here, "fixtures", name);
  return JSON.parse(readFileSync(p, "utf8"));
}

// Minimal env object a test can pass into any function that currently takes
// `env`. Does NOT include real secrets. Side-effect functions check these:
//   - GHL_API_KEY present → they attempt a fetch (test must either stub
//     globalThis.fetch, or set dryRun:true, or omit the key).
//   - CONSOLE_PASSWORD / WEBHOOK_SECRET: tests pass directly when needed.
export function makeStubEnv(overrides = {}) {
  return {
    GHL_API_KEY: "test-ghl-key",
    GHL_LOCATION_ID: "test-loc",
    HL_TRACKING_WEBHOOK: "https://test.invalid/hook",
    ANTHROPIC_API_KEY: "test-anthropic-key",
    ...overrides,
  };
}

// Replace globalThis.fetch for the duration of a test. Returns a function
// that restores the original. Call sites can inspect fetchCalls afterward.
export function captureFetch(responder) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (typeof responder === "function") return responder(url, init);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  return {
    calls,
    restore: () => { globalThis.fetch = orig; },
  };
}

// Build a Claude stub that returns a fixture's agent JSON as the raw text
// Claude would have returned. callClaude / callClaudeWithRubric call this
// when env.__CLAUDE_STUB__ is set; the real API is never contacted.
export function makeClaudeStubFromFixture(fixtureName) {
  const fixture = loadFixture(fixtureName);
  return async () => JSON.stringify(fixture);
}
