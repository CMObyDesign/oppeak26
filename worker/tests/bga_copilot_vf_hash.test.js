// BGA Copilot — vf_hash tests (PR 5a).
//
// Pins the hash contract shared by every verified-financials path.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sha256Hex, hashVerifiedFinancialsRaw } from "../src/bga_copilot/vf_hash.js";

describe("sha256Hex — base helper", () => {
  it("hashes the empty string to the well-known constant", async () => {
    // sha256("") — pinned so a future swap in the hash impl can't
    // silently change what clients already stored.
    assert.equal(
      await sha256Hex(""),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is deterministic for the same input", async () => {
    const a = await sha256Hex("[{\"metric_id\":\"cash_on_hand\",\"value\":100}]");
    const b = await sha256Hex("[{\"metric_id\":\"cash_on_hand\",\"value\":100}]");
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  it("returns 64 lowercase hex characters", async () => {
    const h = await sha256Hex("anything");
    assert.match(h, /^[0-9a-f]{64}$/);
  });

  it("differs when input bytes differ", async () => {
    const a = await sha256Hex("x");
    const b = await sha256Hex("y");
    assert.notEqual(a, b);
  });
});

describe("hashVerifiedFinancialsRaw", () => {
  it("non-string input hashes as the empty string", async () => {
    const empty = await sha256Hex("");
    assert.equal(await hashVerifiedFinancialsRaw(null), empty);
    assert.equal(await hashVerifiedFinancialsRaw(undefined), empty);
    assert.equal(await hashVerifiedFinancialsRaw(42), empty);
    assert.equal(await hashVerifiedFinancialsRaw([]), empty);
  });

  it("string input hashes the string bytes directly", async () => {
    const raw = JSON.stringify([{ metric_id: "revenue_ttm", value: 1800000 }]);
    assert.equal(await hashVerifiedFinancialsRaw(raw), await sha256Hex(raw));
  });

  it("byte-level sensitivity — a trailing space changes the hash", async () => {
    const a = await hashVerifiedFinancialsRaw("[]");
    const b = await hashVerifiedFinancialsRaw("[] ");
    assert.notEqual(a, b);
  });
});
