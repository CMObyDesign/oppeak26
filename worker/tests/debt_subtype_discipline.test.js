// Regression: Solomon must not invent tax liens, judgments, delinquency, or
// debt distress when the customer reports ordinary current corporate debt.
// This bug shipped in a free-tier report once (observed on
// "testing-again-liz") and the rubric was rewritten to forbid the pattern.
// If a future change deletes that paragraph from the rubric or waters it
// down, this test is the backstop.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ASSESSMENT_RUBRIC } from "../src/index.js";
import { loadFixture } from "./helpers.js";

describe("debt subtype discipline", () => {
  it("the rubric explicitly separates corporate debt from tax/legal/distress", () => {
    const rubric = ASSESSMENT_RUBRIC;
    // These three phrases together assert the rubric still carries the
    // debt-subtype discipline rewrite shipped in PR #52.
    assert.match(rubric, /\bcorporate debt\b/i,
      "Rubric must call out corporate debt as a distinct category");
    assert.match(rubric, /\btax (lien|debt)\b/i,
      "Rubric must call out tax liens / tax debt as a distinct category");
    assert.match(rubric, /\b(judgment|lien)s?\b/i,
      "Rubric must call out judgments/liens as a distinct category");
    assert.match(rubric, /\b(delinquent|distressed|default)\b/i,
      "Rubric must call out the distressed/delinquent/default category");
  });

  it("the rubric forbids inventing conditions not in the customer's answers", () => {
    const rubric = ASSESSMENT_RUBRIC;
    // At least one phrase of the form "never invent" / "do not invent" /
    // "unless the customer" or "unless explicitly reported" has to be
    // present; otherwise the discipline is gone.
    const forbidsInvention =
      /\b(never\s+invent|do\s+not\s+invent|unless\s+the\s+customer|unless\s+explicitly|unless\s+reported)\b/i.test(rubric);
    assert.ok(forbidsInvention,
      "Rubric must contain language forbidding Solomon from inventing conditions " +
      "the customer did not report.");
  });

  it("a hand-crafted bad output (invented liens) is detectable by scan", () => {
    // This is a negative control: the fixture is what the WRONG Solomon
    // produced before PR #52. If a scanner-helper is ever added to
    // production, this fixture is what it must flag.
    const bad = loadFixture("liz_bad_debt_output.json");
    const text = JSON.stringify(bad).toLowerCase();
    assert.ok(text.includes("tax lien") || text.includes("judgment"),
      "Bad fixture should contain the invented-condition language we're guarding against");
  });

  it("today's known-good free-tier fixture does not AFFIRM invented conditions", () => {
    // The customer-facing surface (headline + opener + gaps + opportunities)
    // must not contain affirmative uses of tax lien / judgment / distressed /
    // default — those would misrepresent her situation. The strategist
    // brief is allowed to contain the terms when it is explicitly *denying*
    // them ("no judgments or liens"), so we scan only the customer-visible
    // fields.
    const good = loadFixture("liz_free_good.json");
    const customerFacing = [
      good.headline,
      good.opener,
      good.badge,
      good.context,
      good.nextStepHeadline,
      good.nextStepBody,
      ...(good.gaps || []).map((g) => JSON.stringify(g)),
      ...(good.opportunities || []).map((o) => JSON.stringify(o)),
    ].filter(Boolean).join(" | ").toLowerCase();

    for (const banned of ["tax lien", "tax liens", "judgment", "judgments", "distressed", "in default", "delinquent"]) {
      assert.ok(!customerFacing.includes(banned),
        `Customer-facing surface must not contain "${banned}" — Liz's intake reports only current corporate debt.`);
    }
  });
});
