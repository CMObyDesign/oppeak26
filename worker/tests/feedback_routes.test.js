// Phase 3A follow-up: route-level regression for POST /feedback.
//
// Codex caught two P1 bugs in the merged Phase 3A PR:
//
//   1. The POST /feedback branch was nested inside
//      `if (request.method === "GET")`, so POSTs fell through to the
//      public-assessment handler and returned 400 "No answers provided"
//      instead of inserting a feedback row.
//   2. When D1 wasn't wired, POST returned a 503 error instead of the
//      documented graceful-degradation shape (`{skipped:true,
//      reason:"no_db_binding"}`).
//
// These tests pin both. They exercise the default-exported fetch
// handler end-to-end so a future refactor can't re-nest the POST
// inside a GET-only branch without CI going red.
//
// The real worker's handler imports a lot of module-level helpers
// (GHL, R2, D1, Solomon). We only need the /feedback branch to run,
// so the test env can be bare — no bindings — and we only assert on
// the outer response shape.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";

const PW = "test-password";
const envBase = { CONSOLE_PASSWORD: PW };

function makePostFeedback(body, { password = PW, env = envBase } = {}) {
  return worker.fetch(
    new Request("https://example.com/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(password ? { "x-console-password": password } : {}),
      },
      body: JSON.stringify(body),
    }),
    env,
    {},
  );
}

describe("POST /feedback — route reachability", () => {
  it("is reachable at all (regression: was shadowed by GET-only branch)", async () => {
    // Without D1 wired we take the graceful-degradation path and get a
    // 200 skipped. The point of this test is that we do NOT get the
    // "No answers provided" 400 from the public-assessment handler,
    // which is where POSTs ended up when nested inside GET.
    const res = await makePostFeedback({ report_id: "r1", feedback_type: "causal_overreach" });
    assert.notEqual(res.status, 404, "POST /feedback must not 404");
    const body = await res.json();
    assert.notEqual(body.error, "No answers provided", "POST must not fall through to public assessment");
  });

  it("returns {skipped:true, reason:'no_db_binding'} when D1 isn't wired", async () => {
    // Documented graceful-degradation contract — see
    // docs/CLOUDFLARE_DATA_MODEL.md § Strategist feedback (Phase 3A).
    // Must NOT return 503 (the earlier buggy behavior).
    const res = await makePostFeedback({ report_id: "r1", feedback_type: "causal_overreach" });
    assert.equal(res.status, 200, "no-D1 degradation must be 200, not 503");
    const body = await res.json();
    assert.deepEqual(body, { success: true, skipped: true, reason: "no_db_binding" });
  });

  it("rejects an unauthenticated POST with 401 (not 400 fallthrough)", async () => {
    const res = await makePostFeedback(
      { report_id: "r1", feedback_type: "causal_overreach" },
      { password: null },
    );
    assert.equal(res.status, 401);
  });

  it("rejects invalid feedback_type with 400 + the allowed list", async () => {
    const res = await makePostFeedback({ report_id: "r1", feedback_type: "not_a_type" });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "Invalid feedback_type");
    assert.equal(body.got, "not_a_type");
    assert.ok(Array.isArray(body.allowed) && body.allowed.length === 16);
  });

  it("rejects a missing report_id with 400", async () => {
    const res = await makePostFeedback({ feedback_type: "causal_overreach" });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /report_id/);
  });
});

describe("GET /feedback — route reachability", () => {
  it("401s without the console password", async () => {
    const res = await worker.fetch(
      new Request("https://example.com/feedback?report_id=r1"),
      envBase,
      {},
    );
    assert.equal(res.status, 401);
  });

  it("degrades to an empty list when D1 isn't wired", async () => {
    const res = await worker.fetch(
      new Request("https://example.com/feedback?report_id=r1", {
        headers: { "x-console-password": PW },
      }),
      envBase,
      {},
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.skipped, true);
    assert.deepEqual(body.feedback, []);
  });
});
