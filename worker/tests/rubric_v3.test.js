// Rubric v3 smoke tests.
//
// Pins the structural changes landed in the r3.0 rubric rewrite so
// a future accidental revert is caught at CI time, not in prod:
//
//   - RUBRIC_VERSION bumped to r3.0, PROMPT_VERSION to p2.1.
//   - ASSESSMENT_RUBRIC carries the new EVIDENCE HIERARCHY block.
//   - ASSESSMENT_RUBRIC carries the "SEVERITY IS NOT TONE" block.
//   - ASSESSMENT_RUBRIC qualifies Miguel's "drown" phrase as internal
//     philosophy, never permission for crisis language.
//   - TIER_GUIDE.paid_47 emphasizes synthesis (not just more findings).
//   - TIER_GUIDE.paid_47 restricts customer-facing classification to
//     the three allowed values.
//   - TIER_GUIDE.free carries the strength-recognition requirement.
//   - buildPrompt emits the narrowed path enum.
//   - buildPrompt's strategistBrief spec requires "WHAT TO PROBE"
//     coverage (contradictions, assumptions not to make, verifications).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  RUBRIC_VERSION,
  PROMPT_VERSION,
  ASSESSMENT_RUBRIC,
  TIER_GUIDE,
  buildPrompt,
} from "../src/index.js";

describe("Rubric v3 — version bumps", () => {
  it("RUBRIC_VERSION is r3.0", () => {
    assert.equal(RUBRIC_VERSION, "r3.0");
  });

  it("PROMPT_VERSION is p2.1", () => {
    assert.equal(PROMPT_VERSION, "p2.1");
  });
});

describe("Rubric v3 — ASSESSMENT_RUBRIC content", () => {
  it("carries an EVIDENCE HIERARCHY block", () => {
    assert.match(ASSESSMENT_RUBRIC, /EVIDENCE HIERARCHY/);
    // The six-rung ladder: explicit answer → fact → metric → rubric
    // interpretation → qualified inference → recommendation.
    assert.match(ASSESSMENT_RUBRIC, /Explicit customer answer/);
    assert.match(ASSESSMENT_RUBRIC, /Approved rubric interpretation/);
    assert.match(ASSESSMENT_RUBRIC, /Clearly qualified inference/);
  });

  it("carries the SEVERITY IS NOT TONE discipline", () => {
    assert.match(ASSESSMENT_RUBRIC, /SEVERITY IS NOT TONE/);
    // Explicit prohibition on crisis vocabulary. Match the phrase
    // regardless of surrounding punctuation.
    assert.match(ASSESSMENT_RUBRIC, /cash crisis/);
    assert.match(ASSESSMENT_RUBRIC, /existential threat/);
  });

  it("qualifies Miguel's 'drown' phrase as internal philosophy only", () => {
    // Must still name the phrase (it's Miguel's actual methodology).
    assert.match(ASSESSMENT_RUBRIC, /ability to manage, or their ability to drown/);
    // AND must constrain how it's used.
    assert.match(ASSESSMENT_RUBRIC, /INTERNAL diagnostic philosophy/);
    assert.match(ASSESSMENT_RUBRIC, /NEVER permission/);
  });

  it("carries the DO NOT RECALCULATE SUPPLIED METRICS rule", () => {
    assert.match(ASSESSMENT_RUBRIC, /DO NOT RECALCULATE SUPPLIED METRICS/);
  });

  it("ANTI-GENERIC MANDATE requires 'traceable' not 'quote in every title'", () => {
    assert.match(ASSESSMENT_RUBRIC, /MUST be traceable/);
    assert.match(ASSESSMENT_RUBRIC, /Do NOT force awkward quotations/);
  });

  it("FREE-TIER FINDING DISCIPLINE requires one genuine strength", () => {
    assert.match(ASSESSMENT_RUBRIC, /at least ONE genuine strength/);
  });

  it("PATH SELECTION is restricted to three customer-facing values", () => {
    // "urgent" and "strong" should no longer appear as path values
    // in the SWOT ASSESSMENT_RUBRIC's PATH SELECTION block.
    const pathSelection = ASSESSMENT_RUBRIC.match(
      /PATH SELECTION[\s\S]*?(?=\n[A-Z][A-Z ]+:|\n\n[A-Z])/,
    );
    assert.ok(pathSelection, "PATH SELECTION block should exist");
    assert.doesNotMatch(pathSelection[0], /^- "urgent"/m);
    assert.doesNotMatch(pathSelection[0], /^- "strong"/m);
    assert.match(pathSelection[0], /"rehab"/);
    assert.match(pathSelection[0], /"needs-attention"/);
    assert.match(pathSelection[0], /"growth"/);
  });
});

describe("Rubric v3 — TIER_GUIDE content", () => {
  it("free tier requires strength recognition and allowed classification", () => {
    assert.match(TIER_GUIDE.free, /genuine strength or business asset/);
    assert.match(TIER_GUIDE.free, /growth, needs-attention, or rehab/);
  });

  it("paid_47 emphasizes synthesis, not enumeration", () => {
    assert.match(TIER_GUIDE.paid_47, /synthesize the complete picture/);
    assert.match(TIER_GUIDE.paid_47, /interactions between/);
    // No crisis-permission language.
    assert.match(TIER_GUIDE.paid_47, /Do not treat severity as permission/);
    assert.match(TIER_GUIDE.paid_47, /growth, needs-attention, or rehab/);
  });

  it("paid_297 emphasizes prioritization over more findings", () => {
    assert.match(TIER_GUIDE.paid_297, /Prioritize the findings rather than merely adding more/);
    assert.match(TIER_GUIDE.paid_297, /growth, needs-attention, or rehab/);
  });
});

describe("Rubric v3 — buildPrompt output schema", () => {
  const sampleAnswers = [{ question: "Debt?", answer: "none" }];
  const sampleContact = { name: "Test" };

  it("path enum narrowed to {rehab, needs-attention, growth}", () => {
    const prompt = buildPrompt("free", sampleAnswers, sampleContact);
    assert.match(prompt, /"path": "rehab \| needs-attention \| growth"/);
    assert.doesNotMatch(prompt, /\| urgent \|/);
    assert.doesNotMatch(prompt, /\| strong\b/);
  });

  it("strategistBrief spec requires WHAT TO PROBE coverage", () => {
    const prompt = buildPrompt("free", sampleAnswers, sampleContact);
    assert.match(prompt, /WHAT TO PROBE/);
    assert.match(prompt, /contradictions in the intake/);
    assert.match(prompt, /assumptions the strategist should NOT make/);
    assert.match(prompt, /verified before recommending action/);
  });
});
