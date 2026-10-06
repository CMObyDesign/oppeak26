// Phase 1 defense-in-depth: D1 query errors on the public read path
// must fall through, not 500.
//
// Codex caught the window on PR #71: between the moment SOLOMON_DB is
// activated and the moment `wrangler d1 migrations apply` lands, the
// database exists but report_versions / submissions do not. Any D1
// query against the missing table throws, and if the throw propagates
// up through handleReport the public /report/{contactId} read 500s
// instead of falling back to the GHL projection — the Phase 1c
// documented safety net.
//
// The fix: latestSuccessfulReport, latestSubmissionIdForContact,
// reportByVersion, and reportById catch D1 errors, log them, and
// return null. "null" is the same shape they already return for
// "no row," so callers already handle it — handleReport falls through
// to GHL for the default read, and the history path 404s (the
// contract already forbids a GHL fallback for history).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  latestSuccessfulReport,
  latestSubmissionIdForContact,
  reportByVersion,
  reportById,
} from "../src/db.js";

// A D1 mock whose first() always throws — simulates a missing table
// or any other D1 error.
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

describe("D1 fallback — public read path survives schema or outage errors", () => {
  it("latestSuccessfulReport returns null when D1 throws", async () => {
    const result = await latestSuccessfulReport(makeThrowingDb(), "c1");
    assert.equal(result, null);
  });

  it("latestSubmissionIdForContact returns null when D1 throws", async () => {
    const result = await latestSubmissionIdForContact(makeThrowingDb(), "c1");
    assert.equal(result, null);
  });

  it("reportByVersion returns null when D1 throws", async () => {
    const result = await reportByVersion(makeThrowingDb(), "c1", 1);
    assert.equal(result, null);
  });

  it("reportById returns null when D1 throws", async () => {
    const result = await reportById(makeThrowingDb(), "rep_1");
    assert.equal(result, null);
  });

  it("logs the error (does not swallow silently)", async () => {
    const original = console.warn;
    const seen = [];
    console.warn = (msg) => seen.push(msg);
    try {
      await latestSuccessfulReport(makeThrowingDb("boom"), "c1");
      await reportById(makeThrowingDb("boom"), "rep_1");
    } finally {
      console.warn = original;
    }
    assert.ok(seen.some(m => /latestSuccessfulReport.*boom/.test(m)));
    assert.ok(seen.some(m => /reportById.*boom/.test(m)));
  });
});
