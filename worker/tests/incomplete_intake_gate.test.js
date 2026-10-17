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

  it("free tier at 11 answers is ok (all Q1-Q11 required per customer directive 2026-10-17)", () => {
    const answers = Array.from({ length: 11 }, (_, i) => ({ question: `Q${i + 1}`, answer: `A${i + 1}` }));
    const result = checkIntakeCompleteness(answers, "free");
    assert.equal(result.ok, true);
    assert.equal(result.answersSeen, 11);
  });

  it("free tier at 10 answers is NOT ok (floor bumped from 3 → 11 when the browser contract made every Q required)", () => {
    const answers = Array.from({ length: 10 }, (_, i) => ({ question: `Q${i + 1}`, answer: `A${i + 1}` }));
    const result = checkIntakeCompleteness(answers, "free");
    assert.equal(result.ok, false);
  });

  it("free tier identity check — 10 real Q1-Q11 + 1 unrelated CRM field is NOT ok (Codex P1 on #137)", () => {
    // Codex finding: counting pure answers.length is wrong because
    // answersFromContactFields includes every non-Solomon populated
    // custom field with a catalog label. A buyer with 10 real intake
    // answers plus one unrelated CRM field would have cleared the old
    // count-only >= 11 threshold and shipped incomplete intake.
    const freeFieldIds = [
      "5VWVNRrQYcLqXhckh4f4", "nCRqWH0x1sdJIgUPDr2E", "nbPL6APmjrjr43J6urVb",
      "OyQjw4nGNHJYADsq5ggg", "8sSKohKtQZZzJEtM2ju0", "deItnw0p1H7sO1okRjGS",
      "hV9yij5uFitztZzanSaa", "ngBePHf4iKPhaHm2OtSv", "cvuAgfuL94eBahOrnTY0",
      "cdlV9zqJxztcxfXgD4J0", /* Q11 intentionally missing */
    ];
    const rawCustomFields = [
      ...freeFieldIds.map(id => ({ id, value: "answer" })),
      { id: "zzzUnrelatedCrmField", value: "lead source: Facebook" },
    ];
    // answersFromContactFields would return 11 entries here (10 Q1-Q10 + 1 unrelated)
    const fakeAnswers = Array.from({ length: 11 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` }));
    const result = checkIntakeCompleteness(fakeAnswers, "free", { rawCustomFields });
    assert.equal(result.ok, false);
    assert.equal(result.identityCheck, true);
    assert.equal(result.answersSeen, 10, "only 10 of the 11 Q1-Q11 IDs are populated");
  });

  it("free tier identity check — all 11 Q1-Q11 populated (plus noise) is ok", () => {
    const freeFieldIds = [
      "5VWVNRrQYcLqXhckh4f4", "nCRqWH0x1sdJIgUPDr2E", "nbPL6APmjrjr43J6urVb",
      "OyQjw4nGNHJYADsq5ggg", "8sSKohKtQZZzJEtM2ju0", "deItnw0p1H7sO1okRjGS",
      "hV9yij5uFitztZzanSaa", "ngBePHf4iKPhaHm2OtSv", "cvuAgfuL94eBahOrnTY0",
      "cdlV9zqJxztcxfXgD4J0", "qKRvCyjprebbK75tC05h",
    ];
    const rawCustomFields = [
      ...freeFieldIds.map(id => ({ id, value: "answer" })),
      { id: "zzzUnrelatedCrmField", value: "lead source: Facebook" },
    ];
    const fakeAnswers = Array.from({ length: 12 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` }));
    const result = checkIntakeCompleteness(fakeAnswers, "free", { rawCustomFields });
    assert.equal(result.ok, true);
    assert.equal(result.identityCheck, true);
    assert.equal(result.answersSeen, 11);
  });

  it("free tier identity check — a Q1-Q11 field present with empty string value is NOT populated", () => {
    const freeFieldIds = [
      "5VWVNRrQYcLqXhckh4f4", "nCRqWH0x1sdJIgUPDr2E", "nbPL6APmjrjr43J6urVb",
      "OyQjw4nGNHJYADsq5ggg", "8sSKohKtQZZzJEtM2ju0", "deItnw0p1H7sO1okRjGS",
      "hV9yij5uFitztZzanSaa", "ngBePHf4iKPhaHm2OtSv", "cvuAgfuL94eBahOrnTY0",
      "cdlV9zqJxztcxfXgD4J0",
    ];
    const rawCustomFields = [
      ...freeFieldIds.map(id => ({ id, value: "answer" })),
      { id: "qKRvCyjprebbK75tC05h", value: "   " }, // whitespace-only is NOT populated
    ];
    const result = checkIntakeCompleteness([], "free", { rawCustomFields });
    assert.equal(result.ok, false);
    assert.equal(result.answersSeen, 10);
  });

  it("allowPartial bypass lets a historical/partial submission through (Codex P2 on #137)", () => {
    // The old count-only gate blocked manual reruns on pre-contract
    // contacts forever. The new allowPartial flag lets a caller decide
    // to let Solomon's INCOMPLETE INTAKE handling take over per the
    // r3.6 TIER_GUIDE.free rubric.
    const answers = Array.from({ length: 3 }, (_, i) => ({ question: `Q${i + 1}`, answer: `A${i + 1}` }));
    const result = checkIntakeCompleteness(answers, "free", { allowPartial: true });
    assert.equal(result.ok, true);
    assert.equal(result.partial, true);
    assert.equal(result.answersSeen, 3);
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
