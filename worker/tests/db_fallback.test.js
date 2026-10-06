// Phase 1 defense-in-depth: D1 query errors on public read paths
// must fall through, not 500 — AND the fallback semantics are
// decided at the call site, because they differ by caller.
//
// Codex caught two bugs in the first version of this fix (PR #72):
//   1. The catch inside db.js helpers also wrapped `hydrateReport`,
//      so a malformed `diagnostic_json` was silently treated as "no
//      row" and served the stale GHL projection.
//   2. `reportById` is used by both the public /report fallback and
//      the strategist review (where the documented contract is
//      "503 on D1 unavailable, 404 only means the row doesn't
//      exist"). Swallowing in the shared helper broke the strategist
//      contract.
//
// The fix: db.js helpers throw cleanly on D1 errors; the three call
// sites each choose their own fallback:
//
//   - handleReport default read:   D1 error → fall through to GHL.
//   - handleReport history read:   D1 error → 503 "temporarily unavailable".
//   - /strategist/report/{id}:     D1 error → 503. No-row → 404.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import worker, { handleReport } from "../src/index.js";
import { captureFetch } from "./helpers.js";

const PW = "test-password";

function makeThrowingDb(message = "D1_ERROR: no such table") {
  return {
    prepare() {
      return {
        bind() { return this; },
        async first() { throw new Error(message); },
        async all() { throw new Error(message); },
        async run() { throw new Error(message); },
      };
    },
  };
}

// --- handleReport default read: D1 error falls through to GHL -----

describe("handleReport (default read) — D1 error falls through to GHL", () => {
  it("renders a GHL-projected report when latestSuccessfulReport throws", async () => {
    const env = {
      GHL_API_KEY: "test-key",
      SOLOMON_DB: makeThrowingDb(),
    };
    const cap = captureFetch((url) => {
      if (url.includes("/contacts/")) {
        return new Response(
          JSON.stringify({
            contact: {
              id: "c1",
              firstName: "Test",
              lastName: "User",
              email: "test@example.com",
              tags: ["swot_free_free"],
              customFields: [
                { key: "swot_free_report", field_value: "<p>GHL fallback body</p>" },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("", { status: 404 });
    });
    try {
      const res = await handleReport("c1", env, new URL("https://example.com/report/c1"));
      // 200 means we fell through — a 500 would mean the D1 throw propagated.
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.match(body, /GHL fallback body/);
    } finally {
      cap.restore();
    }
  });

  it("still 404s when D1 throws AND GHL has no contact", async () => {
    const env = { GHL_API_KEY: "test-key", SOLOMON_DB: makeThrowingDb() };
    const cap = captureFetch(() => new Response("", { status: 500 }));
    try {
      const res = await handleReport("c1", env, new URL("https://example.com/report/c1"));
      assert.equal(res.status, 404);
    } finally {
      cap.restore();
    }
  });
});

// --- handleReport history read: D1 error → 503, not 404 -----------

describe("handleReport (history read) — D1 error returns 503, not 404", () => {
  it("?v=1 returns 503 when D1 throws (NOT 404 — a holder would read 404 as 'deleted')", async () => {
    const env = { GHL_API_KEY: "test-key", SOLOMON_DB: makeThrowingDb() };
    const res = await handleReport("c1", env, new URL("https://example.com/report/c1?v=1"));
    assert.equal(res.status, 503);
    const body = await res.text();
    assert.match(body, /temporarily unavailable/i);
  });

  it("?report_id= returns 503 when D1 throws", async () => {
    const env = { GHL_API_KEY: "test-key", SOLOMON_DB: makeThrowingDb() };
    const url = new URL("https://example.com/report/c1?report_id=12345678-1234-1234-1234-123456789abc");
    const res = await handleReport("c1", env, url);
    assert.equal(res.status, 503);
  });
});

// --- /strategist/report/{id}: D1 error → 503, no-row → 404 --------

describe("GET /strategist/report/{reportId} — distinguishes D1 error from no-row", () => {
  it("returns 503 when the D1 query throws (NOT 404 — the UI must not say 'no such report')", async () => {
    const env = { CONSOLE_PASSWORD: PW, SOLOMON_DB: makeThrowingDb() };
    const res = await worker.fetch(
      new Request("https://example.com/strategist/report/rep_1", {
        method: "GET",
        headers: { "x-console-password": PW },
      }),
      env, {},
    );
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.error, /temporarily unavailable/i);
  });

  it("still returns 404 when D1 is up but the row doesn't exist", async () => {
    const emptyDb = {
      prepare() {
        return {
          bind() { return this; },
          async first() { return null; },
          async all() { return { results: [] }; },
          async run() { return { success: true }; },
        };
      },
    };
    const env = { CONSOLE_PASSWORD: PW, SOLOMON_DB: emptyDb };
    const res = await worker.fetch(
      new Request("https://example.com/strategist/report/rep_missing", {
        method: "GET",
        headers: { "x-console-password": PW },
      }),
      env, {},
    );
    assert.equal(res.status, 404);
  });
});

// --- hydration errors surface, don't fall back silently -----------
//
// safeParse (in db.js) deliberately throws on malformed JSON — the
// comment there calls it a "data-integrity bug, surface, don't
// swallow." The previous version of this fix had catches in db.js
// that would have hidden a safeParse throw as "no row," masking data
// corruption as a cache miss. With the catches now at the call
// sites, the strategist route surfaces the problem as a 503 and the
// public /report path can log it. Either way the operator sees it.

describe("hydrateReport parse failures — surface via 503, not swallowed", () => {
  it("the strategist route returns 503 (not 200/404) when diagnostic_json is malformed", async () => {
    const malformedDb = {
      prepare() {
        return {
          bind() { return this; },
          async first() {
            return {
              id: "rep_1", submission_id: "sub_1", contact_id: "c1",
              tier: "free", report_version: 1,
              diagnostic_json: "{not json",
              strategist_brief_json: null,
              is_successful: 1, created_at: 1700000000000,
            };
          },
          async all() { return { results: [] }; },
        };
      },
    };
    const env = { CONSOLE_PASSWORD: PW, SOLOMON_DB: malformedDb };
    const res = await worker.fetch(
      new Request("https://example.com/strategist/report/rep_1", {
        method: "GET",
        headers: { "x-console-password": PW },
      }),
      env, {},
    );
    // 503, not 404 — a parse failure is a real problem, not a missing row.
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.error, /temporarily unavailable/i);
  });
});
