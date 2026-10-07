// POST /payment-status — retry-URL writeback on failure (Codex P1 on #78).
//
// On a failed payment, HL fires the retry email on the failure tag we apply.
// That email reads {{contact.swot_retry_payment_url}} for its retry button.
// The handler must write the field BEFORE applying the failure tag so the
// button always has a valid href.
//
// Before the fix: handler applied only the failure tag; the field stayed
// unset. After the earlier template simplification (which dropped
// unsupported inline Handlebars fallbacks), the retry button rendered an
// empty href.
//
// This test asserts:
//   - failure request → PUT /contacts/{id} with
//       customFields:[{ key: "swot_retry_payment_url", field_value: PAYMENT_LINK_<tier> }]
//     fires at least once.
//   - PUT /contacts/{id}/tags with the failure tag fires at least once.
//   - the field PUT lands before the tag POST (so the retry email never
//     fires against an empty field).
//   - success request does NOT write the retry field (we only want it set
//     when a retry is actually about to be requested).
//   - either tier writes the correct tier-specific payment URL.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";
import { captureFetch } from "./helpers.js";

const SECRET = "test-webhook-secret";
const PAYMENT_LINK_47 = "https://my.cfobydesign.com/payment-link/6a0db7aa1a6dcdeebb53b641";
const PAYMENT_LINK_297 = "https://my.cfobydesign.com/payment-link/6a0db7ceee2395af2c17f5d0";

function postPaymentStatus(body) {
  return new Request("https://example.com/payment-status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-secret": SECRET,
    },
    body: JSON.stringify(body),
  });
}

function makeEnv() {
  // GHL_API_KEY present → the handler attempts real fetch, which captureFetch
  // intercepts. No HL_TRACKING_WEBHOOK so fireTrackingEvent short-circuits.
  return {
    GHL_API_KEY: "test-ghl-key",
    GHL_LOCATION_ID: "test-loc",
    WEBHOOK_SECRET: SECRET,
  };
}

async function waitForWaitUntil(ctx) {
  // worker.fetch wraps ctx.waitUntil tasks; running tests must drain them.
  // We expose a tiny helper here: the ExecutionContext we hand the worker
  // records its own queue which we flush before asserting.
  await Promise.allSettled(ctx.__tasks);
}

function makeCtx() {
  const tasks = [];
  return {
    waitUntil: (p) => tasks.push(p),
    __tasks: tasks,
  };
}

describe("POST /payment-status — swot_retry_payment_url writeback (Codex P1 on #78)", () => {
  it("failed paid_47 writes PAYMENT_LINK_47 to swot_retry_payment_url BEFORE applying the failure tag", async () => {
    const env = makeEnv();
    const ctx = makeCtx();
    const cap = captureFetch(() =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    try {
      const res = await worker.fetch(
        postPaymentStatus({
          contactId: "c1",
          tier: "paid_47",
          status: "failed",
          amount: 47,
          paymentId: "pm_test",
          email: "test@example.com",
          reason: "card_declined",
        }),
        env,
        ctx,
      );
      assert.equal(res.status, 200);
      await waitForWaitUntil(ctx);

      // Find the PUT /contacts/{id} that writes customFields.
      const fieldWrites = cap.calls.filter(
        (c) =>
          c.url.endsWith("/contacts/c1") &&
          c.init?.method === "PUT",
      );
      assert.ok(fieldWrites.length >= 1, "swot_retry_payment_url write must fire");
      const bodies = fieldWrites.map((c) => JSON.parse(c.init.body));
      const retryWrite = bodies.find((b) =>
        (b.customFields || []).some(
          (f) =>
            f.key === "swot_retry_payment_url" &&
            f.field_value === PAYMENT_LINK_47,
        ),
      );
      assert.ok(
        retryWrite,
        "a PUT must set swot_retry_payment_url = PAYMENT_LINK_47",
      );

      // Find the POST /contacts/{id}/tags with the failure tag.
      const tagWrites = cap.calls.filter(
        (c) =>
          c.url.endsWith("/contacts/c1/tags") &&
          (c.init?.method === "POST" || !c.init?.method),
      );
      assert.ok(tagWrites.length >= 1, "failure tag apply must fire");
      const failureTagApplied = tagWrites.some((c) => {
        try {
          const b = JSON.parse(c.init.body);
          return (b.tags || []).includes("swot_payment_failed_47");
        } catch {
          return false;
        }
      });
      assert.ok(failureTagApplied, "swot_payment_failed_47 must be applied");

      // Ordering: the field PUT must appear in the call log BEFORE the tag POST.
      // captureFetch records calls in start order, so the first PUT index <
      // first failure-tag POST index.
      const firstFieldIdx = cap.calls.findIndex(
        (c) => c.url.endsWith("/contacts/c1") && c.init?.method === "PUT",
      );
      const firstTagIdx = cap.calls.findIndex(
        (c) =>
          c.url.endsWith("/contacts/c1/tags") &&
          (c.init?.method === "POST" || !c.init?.method),
      );
      assert.ok(
        firstFieldIdx >= 0 && firstTagIdx >= 0 && firstFieldIdx < firstTagIdx,
        `swot_retry_payment_url write (idx ${firstFieldIdx}) must land BEFORE the failure tag (idx ${firstTagIdx}) so the retry email never sees an empty href`,
      );
    } finally {
      cap.restore();
    }
  });

  it("failed paid_297 writes PAYMENT_LINK_297 (tier-correct URL)", async () => {
    const env = makeEnv();
    const ctx = makeCtx();
    const cap = captureFetch(() =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    try {
      await worker.fetch(
        postPaymentStatus({
          contactId: "c2",
          tier: "paid_297",
          status: "failed",
          amount: 297,
        }),
        env,
        ctx,
      );
      await waitForWaitUntil(ctx);

      const fieldWrites = cap.calls.filter(
        (c) =>
          c.url.endsWith("/contacts/c2") &&
          c.init?.method === "PUT",
      );
      const bodies = fieldWrites.map((c) => JSON.parse(c.init.body));
      const retryWrite = bodies.find((b) =>
        (b.customFields || []).some(
          (f) =>
            f.key === "swot_retry_payment_url" &&
            f.field_value === PAYMENT_LINK_297,
        ),
      );
      assert.ok(
        retryWrite,
        "paid_297 failure must write swot_retry_payment_url = PAYMENT_LINK_297, NOT the paid_47 URL",
      );
    } finally {
      cap.restore();
    }
  });

  it("successful payment does NOT write swot_retry_payment_url (no retry needed)", async () => {
    const env = makeEnv();
    const ctx = makeCtx();
    const cap = captureFetch(() =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    try {
      await worker.fetch(
        postPaymentStatus({
          contactId: "c3",
          tier: "paid_47",
          status: "success",
          amount: 47,
        }),
        env,
        ctx,
      );
      await waitForWaitUntil(ctx);

      // Any PUT to /contacts/c3 that touches swot_retry_payment_url is a bug —
      // on success we don't want a stale retry URL hanging around on the
      // contact, and this handler is the only writer of that field.
      const retryWrites = cap.calls.filter((c) => {
        if (
          !c.url.endsWith("/contacts/c3") ||
          c.init?.method !== "PUT"
        )
          return false;
        try {
          const b = JSON.parse(c.init.body);
          return (b.customFields || []).some(
            (f) => f.key === "swot_retry_payment_url",
          );
        } catch {
          return false;
        }
      });
      assert.equal(
        retryWrites.length,
        0,
        "a successful payment must not write swot_retry_payment_url",
      );
    } finally {
      cap.restore();
    }
  });

  it("env.PAYMENT_LINK_297 override wins over the CONFIG default", async () => {
    const env = {
      ...makeEnv(),
      PAYMENT_LINK_297: "https://staging.cfobydesign.com/pay/297-staging",
    };
    const ctx = makeCtx();
    const cap = captureFetch(() =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    try {
      await worker.fetch(
        postPaymentStatus({
          contactId: "c4",
          tier: "paid_297",
          status: "failed",
        }),
        env,
        ctx,
      );
      await waitForWaitUntil(ctx);

      const putCalls = cap.calls.filter(
        (c) =>
          c.url.endsWith("/contacts/c4") &&
          c.init?.method === "PUT",
      );
      const found = putCalls.some((c) => {
        try {
          const b = JSON.parse(c.init.body);
          return (b.customFields || []).some(
            (f) =>
              f.key === "swot_retry_payment_url" &&
              f.field_value === "https://staging.cfobydesign.com/pay/297-staging",
          );
        } catch {
          return false;
        }
      });
      assert.ok(
        found,
        "env.PAYMENT_LINK_297 must override CONFIG.PAYMENT_LINK_297 for retry-URL writeback",
      );
    } finally {
      cap.restore();
    }
  });
});
