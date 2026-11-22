// CFO Portal staff pass (src/portal_pass.js). Pins the funnel-safety rules from
// client-portal-rebuild/specs/SOLOMON_IN_PORTAL.md: a pass only ever reaches allowlisted console
// endpoints, and is refused before routing for everything else.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";
import { gatePortalPass, isAllowlisted, portalPassFor, signPortalPass } from "../src/portal_pass.js";

const KEY = "test-portal-pass-key";
const env = { PORTAL_PASS_KEY: KEY, CONSOLE_PASSWORD: "pw" };

async function passFor(ep, { method = "POST", role = "advisor", key = KEY, ttl = 60, extra = {} } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return signPortalPass({ v: 1, aud: "solomon", sid: 7, name: "Val", role, cid: "c1", ep, m: method, iat: now, exp: now + ttl, ...extra }, key);
}

function req(path, token, { method = "POST", body } = {}) {
  return new Request(`https://example.com${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { "x-portal-pass": token } : {}) },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
}

describe("portal pass gate", () => {
  it("lets a good pass through for an allowlisted endpoint and marks the request", async () => {
    const r = req("/asksolomon/case/search", await passFor("/asksolomon/case/search"));
    assert.equal(await gatePortalPass(r, env), null);
    assert.equal(portalPassFor(r).sid, 7);
  });

  it("ignores requests without a pass", async () => {
    assert.equal(await gatePortalPass(req("/asksolomon/case/search", null), env), null);
  });

  it("refuses a pass signed with another key, expired, too long-lived, or for another endpoint", async () => {
    const cases = [
      [await passFor("/asksolomon/case/search", { key: "wrong" }), 401],
      [await passFor("/asksolomon/case/search", { ttl: -5 }), 401],
      [await passFor("/asksolomon/case/search", { ttl: 600 }), 401],
      [await passFor("/asksolomon/case/load"), 401],
      [await passFor("/asksolomon/case/search", { method: "GET" }), 401],
    ];
    for (const [tok, status] of cases) {
      const res = await gatePortalPass(req("/asksolomon/case/search", tok), env);
      assert.equal(res?.status, status);
    }
  });

  it("fails closed when the key isn't configured", async () => {
    const res = await gatePortalPass(req("/asksolomon/case/search", await passFor("/asksolomon/case/search")), { CONSOLE_PASSWORD: "pw" });
    assert.equal(res?.status, 503);
  });

  it("never lets a pass reach the funnel, payments, tags, sending, or client writes", async () => {
    const blocked = [
      "/",
      "/audit",
      "/marketing",
      "/audit/render",
      "/upload",
      "/verify",
      "/verify-bga-access",
      "/from-ghl-survey",
      "/payment-status",
      "/apply-solomon50",
      "/reset-contact-tags",
      "/feedback",
      "/asksolomon/send-result",
      "/asksolomon/case/approve-and-send",
      "/asksolomon/case/overrides/all",
      "/diag/webhook-secret",
    ];
    for (const path of blocked) {
      assert.equal(isAllowlisted(path, "POST"), false, path);
      const res = await gatePortalPass(req(path, await passFor(path)), env);
      assert.equal(res?.status, 403, path);
    }
  });

  it("refuses /asksolomon/run with a contactId, allows it without", async () => {
    const tok = await passFor("/asksolomon/run", { extra: { cid: null } });
    assert.equal((await gatePortalPass(req("/asksolomon/run", await passFor("/asksolomon/run"), { body: { question: "x" } }), env))?.status, 403);
    assert.equal((await gatePortalPass(req("/asksolomon/run", tok, { body: { contactId: "abc", question: "x" } }), env))?.status, 403);
    assert.equal((await gatePortalPass(req("/asksolomon/run", tok, { body: { contact_id: "abc" } }), env))?.status, 403);
    assert.equal((await gatePortalPass(req("/asksolomon/run", tok, { body: { contact: { contactId: "abc" }, confirmOverwrite: true } }), env))?.status, 403);
    assert.equal((await gatePortalPass(req("/asksolomon/run", tok, { body: { contact: { id: "abc" } } }), env))?.status, 403);
    assert.equal(await gatePortalPass(req("/asksolomon/run", tok, { body: { question: "x" } }), env), null);
  });

  it("keeps catalog publishing to admins", async () => {
    const path = "/asksolomon/catalog/publish";
    assert.equal((await gatePortalPass(req(path, await passFor(path)), env))?.status, 403);
    assert.equal(await gatePortalPass(req(path, await passFor(path, { role: "admin" })), env), null);
  });

  it("ties each path to its methods: no history wipe, no library upload, no rubric edits", async () => {
    assert.equal(isAllowlisted("/asksolomon/history", "DELETE"), false);
    assert.equal(isAllowlisted("/asksolomon/library", "POST"), false);
    assert.equal(isAllowlisted("/asksolomon/rubrics", "POST"), false);
    assert.equal(isAllowlisted("/asksolomon/case/load", "GET"), false);
    assert.equal(isAllowlisted("/asksolomon/history", "POST"), true);
    assert.equal(isAllowlisted("/asksolomon/library", "GET"), true);
    const del = await passFor("/asksolomon/history", { method: "DELETE" });
    const res = await gatePortalPass(new Request("https://example.com/asksolomon/history", { method: "DELETE", headers: { "x-portal-pass": del } }), env);
    assert.equal(res?.status, 403);
  });

  it("allows strategist reads by GET only", async () => {
    assert.equal(isAllowlisted("/strategist/report/abc", "GET"), true);
    assert.equal(isAllowlisted("/strategist/report/abc", "POST"), false);
  });

  it("end to end: the worker refuses a pass on a funnel route before routing", async () => {
    const res = await worker.fetch(req("/from-ghl-survey", await passFor("/from-ghl-survey")), env, {});
    assert.equal(res.status, 403);
    const res2 = await worker.fetch(req("/asksolomon/case/approve-and-send", await passFor("/asksolomon/case/approve-and-send")), env, {});
    assert.equal(res2.status, 403);
  });
});
