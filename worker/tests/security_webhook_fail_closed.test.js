// Webhooks fail closed when WEBHOOK_SECRET is unset (security review 2026-11-19).
//
// /from-ghl-survey, /payment-status and /reset-contact-tags used to skip the
// secret check entirely when WEBHOOK_SECRET was missing on a deploy. They
// must now refuse (500) without touching GHL, and still 401 a wrong secret.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";
import { captureFetch } from "./helpers.js";

const ROUTES = ["/from-ghl-survey", "/payment-status", "/reset-contact-tags"];
const BODY = JSON.stringify({ contactId: "c1", tier: "paid_297", status: "success" });

function post(route, headers = {}) {
  return new Request(`https://example.com${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: BODY,
  });
}

const ctx = { waitUntil() {} };

describe("webhooks fail closed", () => {
  for (const route of ROUTES) {
    it(`${route}: unset WEBHOOK_SECRET → 500 and no GHL call`, async () => {
      const f = captureFetch();
      try {
        const res = await worker.fetch(post(route), { GHL_API_KEY: "k" }, ctx);
        assert.equal(res.status, 500);
        assert.equal(f.calls.length, 0);
      } finally { f.restore(); }
    });

    it(`${route}: wrong secret → 401`, async () => {
      const f = captureFetch();
      try {
        const env = { GHL_API_KEY: "k", WEBHOOK_SECRET: "right" };
        const r1 = await worker.fetch(post(route, { "x-webhook-secret": "wrong" }), env, ctx);
        assert.equal(r1.status, 401);
        const r2 = await worker.fetch(post(route, { authorization: "Bearer wrong" }), env, ctx);
        assert.equal(r2.status, 401);
        const r3 = await worker.fetch(post(route), env, ctx);
        assert.equal(r3.status, 401);
        assert.equal(f.calls.length, 0);
      } finally { f.restore(); }
    });

    it(`${route}: correct Bearer secret gets past auth`, async () => {
      const f = captureFetch(() => new Response("{}", { status: 404 }));
      try {
        const env = { GHL_API_KEY: "k", WEBHOOK_SECRET: "right" };
        const res = await worker.fetch(post(route, { authorization: "Bearer right" }), env, ctx);
        assert.notEqual(res.status, 401);
        assert.notEqual(res.status, 500);
      } finally { f.restore(); }
    });
  }
});
