// Rubric v3 smoke tests.
//
// Pins the structural changes landed in the r3.0 rubric rewrite so
// a future accidental revert is caught at CI time, not in prod:
//
//   - RUBRIC_VERSION bumped to r3.0, PROMPT_VERSION to p2.2 (p2.2
//     added to let `writeCanonicalRecord`-stored provenance tell
//     Deep-Dive-era paid_297 reports apart from Business-Growth-
//     Analysis-era paid_297 reports; Codex P2 on #76).
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
  it("RUBRIC_VERSION is r3.2 (bumped from r3.1 when MIGUEL'S POINT OF VIEW block + TWO CRITICAL DEBT NUMBERS rewrite landed)", () => {
    assert.equal(RUBRIC_VERSION, "r3.2");
  });

  it("PROMPT_VERSION is p2.2 (bumped from p2.1 when TIER_GUIDE.paid_297 was rewritten for BGA)", () => {
    assert.equal(PROMPT_VERSION, "p2.2");
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

  it("carries the VOICE DISCIPLINE counterpart (2026-10-17 customer directive)", () => {
    // The brand rule: guardrails control truthfulness, not personality.
    // Locked here so a future rubric edit can't silently neutralize
    // Miguel's voice back to AI-safe consultant filler.
    assert.match(ASSESSMENT_RUBRIC, /VOICE DISCIPLINE/);
    assert.match(ASSESSMENT_RUBRIC, /guardrails control truthfulness, not personality/i);
    assert.match(ASSESSMENT_RUBRIC, /Miguel's voice \+ Solomon's evidence discipline/);
    assert.match(ASSESSMENT_RUBRIC, /NOT: AI-safe generic financial copy/);
  });

  it("carries MIGUEL'S POINT OF VIEW / SOLOMON'S VOICE block (2026-10-17 round-2 directive)", () => {
    // Explicit Miguel voice description — cadence, write-like-a-CFO stance,
    // supported/not-supported examples, no em dashes, no impersonation.
    // Locked here so this block can't be stripped or softened.
    assert.match(ASSESSMENT_RUBRIC, /MIGUEL'S POINT OF VIEW \/ SOLOMON'S VOICE/);
    assert.match(ASSESSMENT_RUBRIC, /Write like an experienced CFO sitting across the table from an owner/);
    assert.match(ASSESSMENT_RUBRIC, /Confidence is not permission to overstate/);
    assert.match(ASSESSMENT_RUBRIC, /When the evidence stops, the claim stops/);
    assert.match(ASSESSMENT_RUBRIC, /Do not use em dashes in customer-facing output/);
    assert.match(ASSESSMENT_RUBRIC, /Do not impersonate Miguel/);
    // Both halves of the supported/not-supported example pair must be present.
    assert.match(ASSESSMENT_RUBRIC, /Those two answers belong in the same[\s\S]+?conversation/);
    assert.match(ASSESSMENT_RUBRIC, /Moving to retainers will reduce your client concentration/);
  });

  it("carries THE TWO CRITICAL DEBT NUMBERS (rewrite that drops the cash-flow overclaim)", () => {
    // Keeps Miguel's concept; drops the previous "together these tell you
    // whether cash flow can actually support the business" overclaim.
    // The free-tier info-gap script must stay verbatim so a healthy Q4
    // "managed debt" answer never gets flipped into evidence of distress.
    assert.match(ASSESSMENT_RUBRIC, /THE TWO CRITICAL DEBT NUMBERS/);
    assert.match(ASSESSMENT_RUBRIC, /are two of the most\s+basic numbers an owner should know/);
    assert.match(ASSESSMENT_RUBRIC, /Do not treat them as sufficient, by themselves/);
    assert.match(ASSESSMENT_RUBRIC, /What this Health Check cannot tell us is how much the business is carrying/);
    assert.match(ASSESSMENT_RUBRIC, /legitimate information gap and a reason for deeper diagnosis/);
    // Hard regression bar: the discarded overclaim must stay out.
    assert.doesNotMatch(ASSESSMENT_RUBRIC, /these tell you whether cash flow can actually support the business/);
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

  it("paid_297 is named Business Growth Analysis (BGA), not Deep Dive, and emphasizes 90-day growth planning", () => {
    assert.match(TIER_GUIDE.paid_297, /BUSINESS GROWTH ANALYSIS \(BGA\)/);
    assert.match(TIER_GUIDE.paid_297, /90-day growth plan/);
    assert.match(TIER_GUIDE.paid_297, /what deserves action first/);
    // The public product name is now "Business Growth Analysis," not
    // "Deep Dive." The internal tier identifier `paid_297` stays.
    assert.doesNotMatch(TIER_GUIDE.paid_297, /^\$297 DEEP DIVE/m);
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
