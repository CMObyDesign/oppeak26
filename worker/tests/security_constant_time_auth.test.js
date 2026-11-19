// Constant-time secret compare + no length leak (security review 2026-11-19).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import worker, { safeEqual, checkConsolePassword } from "../src/index.js";

function req(path, headers = {}) {
  return new Request(`https://example.com${path}`, { headers });
}

describe("safeEqual", () => {
  it("matches equal strings and rejects everything else", () => {
    assert.equal(safeEqual("abc", "abc"), true);
    assert.equal(safeEqual("abd", "abc"), false);
    assert.equal(safeEqual("ab", "abc"), false);
    assert.equal(safeEqual("abcd", "abc"), false);
    assert.equal(safeEqual("", "abc"), false);
    assert.equal(safeEqual("abc\u0000", "abc"), false);
    assert.equal(safeEqual(null, "abc"), false);
    assert.equal(safeEqual("abc", undefined), false);
    assert.equal(safeEqual("pässwörd", "pässwörd"), true);
  });
});

describe("checkConsolePassword", () => {
  const env = { CONSOLE_PASSWORD: "pw-one", CONSOLE_EMBED_TOKEN: "embed-two" };
  it("accepts the password or the embed token", () => {
    assert.equal(checkConsolePassword(req("/", { "x-console-password": "pw-one" }), env), true);
    assert.equal(checkConsolePassword(req("/", { "x-console-password": "embed-two" }), env), true);
  });
  it("rejects wrong, missing, prefix and empty-secret cases", () => {
    assert.equal(checkConsolePassword(req("/", { "x-console-password": "pw-on" }), env), false);
    assert.equal(checkConsolePassword(req("/"), env), false);
    assert.equal(checkConsolePassword(req("/", { "x-console-password": "x" }), {}), false);
  });
});

describe("diag endpoints do not leak secret length", () => {
  const env = { CONSOLE_PASSWORD: "secret-value", WEBHOOK_SECRET: "another-secret" };
  it("/asksolomon/diag returns only a boolean", async () => {
    const res = await worker.fetch(req("/asksolomon/diag"), env, {});
    const body = await res.json();
    assert.equal(body.passwordConfigured, true);
    assert.ok(!("passwordLength" in body));
  });
  it("/diag/webhook-secret returns only a boolean", async () => {
    const res = await worker.fetch(req("/diag/webhook-secret"), env, {});
    const body = await res.json();
    assert.equal(body.configured, true);
    assert.ok(!("length" in body));
  });
});
