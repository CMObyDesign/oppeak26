// Regression: free-tier output must respect its caps — at most 3 primary
// gaps and 2 opportunities. The caps live in TIER_GUIDE (the rubric
// instructs Solomon on them) and today's known-good fixture reflects
// that behavior. If a future rubric edit widens the free tier, this
// test catches it either in the prose or in the shipped output shape.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TIER_GUIDE } from "../src/index.js";
import { loadFixture } from "./helpers.js";

const FREE_GAP_CAP = 3;
const FREE_OPPORTUNITY_CAP = 2;

describe("free-tier finding caps", () => {
  it("TIER_GUIDE still prescribes the free-tier cap", () => {
    // TIER_GUIDE is an object keyed by tier.
    assert.ok(typeof TIER_GUIDE?.free === "string",
      "TIER_GUIDE.free should be a string");
    assert.match(TIER_GUIDE.free, /\b(2-3|two to three|three|highest-confidence)\b/i,
      "TIER_GUIDE.free must still describe the 2-3 gap cap");
  });

  it("today's known-good free fixture respects the caps", () => {
    const good = loadFixture("liz_free_good.json");
    assert.ok(Array.isArray(good.gaps), "fixture should have a gaps array");
    assert.ok(Array.isArray(good.opportunities), "fixture should have an opportunities array");
    assert.ok(good.gaps.length <= FREE_GAP_CAP,
      `Free tier may ship at most ${FREE_GAP_CAP} gaps; fixture has ${good.gaps.length}`);
    assert.ok(good.opportunities.length <= FREE_OPPORTUNITY_CAP,
      `Free tier may ship at most ${FREE_OPPORTUNITY_CAP} opportunities; fixture has ${good.opportunities.length}`);
  });

  it("the known-good free fixture has at least one gap and one opportunity (not empty)", () => {
    // An empty free report is not useful — if Solomon ships one, the free
    // conversion CTA stops working. Confirm the fixture isn't degenerate.
    const good = loadFixture("liz_free_good.json");
    assert.ok(good.gaps.length >= 1, "free report should surface at least one gap");
    assert.ok(good.opportunities.length >= 1, "free report should surface at least one opportunity");
  });
});
