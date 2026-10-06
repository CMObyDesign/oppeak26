// Regression: GHL fires the survey-submitted webhook asynchronously and can
// reach us before every custom-field value has landed on the contact. If
// Solomon runs on a half-written intake, it ships an INCOMPLETE INTAKE
// report and the delivery email goes out carrying it. PR #55 added a
// minimum-answers gate (`checkIntakeCompleteness`) that returns `ok:false`
// when the intake is below threshold; the handler surfaces 409 so GHL
// retries once the rest of the fields are there.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkIntakeCompleteness, INTAKE_MIN_ANSWERS } from "../src/index.js";

describe("intake completeness gate", () => {
  it("has a floor configured for every known tier", () => {
    assert.ok(INTAKE_MIN_ANSWERS.free > 0, "free tier must have a floor");
    assert.ok(INTAKE_MIN_ANSWERS.paid_47 > 0, "paid_47 must have a floor");
    assert.ok(INTAKE_MIN_ANSWERS.paid_297 > 0, "paid_297 must have a floor");
  });

  it("paid_47 with 1 answer is NOT ok (testing-again-liz bug)", () => {
    const answers = [{ question: "First field", answer: "x" }];
    const result = checkIntakeCompleteness(answers, "paid_47");
    assert.equal(result.ok, false, "A single-answer paid_47 intake must defer");
    assert.equal(result.answersSeen, 1);
    assert.equal(result.minExpected, INTAKE_MIN_ANSWERS.paid_47);
    assert.equal(result.tier, "paid_47");
  });

  it("paid_47 at the floor is ok", () => {
    const answers = Array.from({ length: INTAKE_MIN_ANSWERS.paid_47 },
      (_, i) => ({ question: `Q${i}`, answer: `A${i}` }));
    const result = checkIntakeCompleteness(answers, "paid_47");
    assert.equal(result.ok, true, "Exactly the floor count must pass");
  });

  it("paid_47 with 19 answers (today's good run) is ok", () => {
    const answers = Array.from({ length: 19 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` }));
    const result = checkIntakeCompleteness(answers, "paid_47");
    assert.equal(result.ok, true);
    assert.equal(result.answersSeen, 19);
  });

  it("free tier at 3 answers is ok (free intake is intentionally small)", () => {
    const answers = Array.from({ length: 3 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` }));
    const result = checkIntakeCompleteness(answers, "free");
    assert.equal(result.ok, true);
  });

  it("free tier at 1 answer is NOT ok", () => {
    const answers = [{ question: "First", answer: "x" }];
    const result = checkIntakeCompleteness(answers, "free");
    assert.equal(result.ok, false);
  });

  it("unknown tier passes (no floor configured)", () => {
    // Defensive: if a new tier string shows up before its floor is set,
    // we don't want to block generation.
    const answers = [{ question: "Q", answer: "A" }];
    const result = checkIntakeCompleteness(answers, "paid_future");
    assert.equal(result.ok, true);
  });

  it("empty / null answers return a shaped failure, not throw", () => {
    for (const bad of [null, undefined, [], "not an array"]) {
      const result = checkIntakeCompleteness(bad, "paid_47");
      assert.equal(result.ok, false);
      assert.equal(result.answersSeen, 0);
      assert.equal(result.minExpected, INTAKE_MIN_ANSWERS.paid_47);
    }
  });
});
