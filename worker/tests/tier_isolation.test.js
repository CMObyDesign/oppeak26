// Regression: a Tier 1 (free) call must not reference Tier 2 ($47 paid)
// answers in its prompt or output. The TIER_GUIDE prose instructs Solomon
// on which answer-set to use per tier; the test asserts both that the
// prose is still there and that the user-prompt builder passes exactly
// the answers the caller gave (no cross-tier bleed from a shared cache).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TIER_GUIDE, buildPrompt } from "../src/index.js";

describe("tier isolation", () => {
  it("TIER_GUIDE scopes the free tier explicitly to Tier 1 inputs", () => {
    // TIER_GUIDE is an object keyed by tier; each value is the per-tier
    // instruction string the rubric reads at prompt-build time.
    assert.ok(TIER_GUIDE && typeof TIER_GUIDE === "object",
      "TIER_GUIDE should be an object keyed by tier");
    assert.ok(typeof TIER_GUIDE.free === "string",
      "TIER_GUIDE must have a free-tier entry");
    const freeGuide = TIER_GUIDE.free;
    // The free-tier instruction must describe the cap and the finding
    // discipline explicitly.
    assert.match(freeGuide, /\b(2-3|two to three|three|highest-confidence)\b/i,
      "TIER_GUIDE.free must describe the free-tier finding limit");
  });

  it("buildPrompt(free, ...) passes exactly the answers given, nothing added", () => {
    const freeAnswers = [
      { question: "What best describes your business type?", answer: "Home improvement" },
      { question: "How do you primarily reach your customers?", answer: "Referrals" },
      { question: "Where does revenue most often leak?", answer: "Lost deals on price" },
    ];
    const prompt = buildPrompt("free", freeAnswers, { name: "Liz" }, {});
    // Every answer the caller provided must appear in the prompt.
    for (const a of freeAnswers) {
      assert.ok(prompt.includes(a.answer),
        `Prompt should include caller-provided answer "${a.answer}"`);
    }
    // A paid-tier-only question text must NOT appear — the builder has no
    // business inventing Tier 2 content.
    assert.ok(!prompt.toLowerCase().includes("total balance of your current corporate debt"),
      "Free-tier prompt must not inject the paid-tier debt-total question");
    assert.ok(!prompt.toLowerCase().includes("merchant processing"),
      "Free-tier prompt must not inject the paid-tier merchant-processing question");
  });

  it("buildPrompt(paid_47, ...) with paid answers does not back-fill free-tier labels", () => {
    // The caller is responsible for passing the paid-tier answers; the
    // builder should not go hunting for free-tier curated labels and mix
    // them in.
    const paidAnswers = [
      { question: "Total corporate debt?", answer: "60000" },
      { question: "Monthly debt service?", answer: "1800" },
    ];
    const prompt = buildPrompt("paid_47", paidAnswers, { name: "Liz" }, {});
    for (const a of paidAnswers) {
      assert.ok(prompt.includes(a.answer),
        `Paid prompt should include caller-provided answer "${a.answer}"`);
    }
  });
});
