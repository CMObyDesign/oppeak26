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
  INTAKE_MIN_ANSWERS,
  buildPrompt,
} from "../src/index.js";

describe("Rubric v3 — version bumps", () => {
  it("RUBRIC_VERSION is r3.6 (bumped from r3.5 when the approved TIER_GUIDE.paid_47 rewrite landed)", () => {
    assert.equal(RUBRIC_VERSION, "r3.6");
  });

  it("PROMPT_VERSION is p2.3 (bumped from p2.2 when the JSON ESCAPING output rule was added to buildPrompt)", () => {
    assert.equal(PROMPT_VERSION, "p2.3");
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

  it("separates CASH-FLOW STRESS from FINANCIAL-VISIBILITY GAPS (2026-10-17 round-3 directive)", () => {
    // Not having an audit is not proof of cash-flow stress. These are
    // two different signal buckets and the rubric must say so, with
    // explicit evidence lists for each.
    assert.match(ASSESSMENT_RUBRIC, /CASH-FLOW AND FINANCIAL-VISIBILITY SIGNALS/);
    assert.match(ASSESSMENT_RUBRIC, /Do not confuse financial visibility with actual cash-flow distress/);
    assert.match(ASSESSMENT_RUBRIC, /CASH-FLOW STRESS requires evidence such as/);
    assert.match(ASSESSMENT_RUBRIC, /materially aged receivables/);
    assert.match(ASSESSMENT_RUBRIC, /FINANCIAL-VISIBILITY GAPS include/);
    assert.match(ASSESSMENT_RUBRIC, /making decisions primarily from bank balance/);
    assert.match(ASSESSMENT_RUBRIC, /A visibility gap matters because it makes decisions harder to evaluate/);
    assert.match(ASSESSMENT_RUBRIC, /It is NOT automatically proof that cash flow is bad/);
    // Hard regression bar: the discarded "no documented financial plan /
    // never had a financial audit" bullet must stay out of the cash-flow
    // stress list — that was the overclaim being corrected.
    assert.doesNotMatch(ASSESSMENT_RUBRIC, /No documented financial plan or budget; never had a financial audit or deep dive\./);
  });

  it("carries the PATTERN RECOGNITION rules (2026-10-17 round-4 directive)", () => {
    // Explicit "connect answers when the relationship is real" rule.
    // Locked here so a future rubric edit can't silently flatten
    // Solomon back into a per-question summarizer.
    assert.match(ASSESSMENT_RUBRIC, /PATTERN RECOGNITION/);
    assert.match(ASSESSMENT_RUBRIC, /Solomon is not a question-by-question summarizer/);
    assert.match(ASSESSMENT_RUBRIC, /Connect answers when the relationship is real/);
    assert.match(ASSESSMENT_RUBRIC, /A pattern can support a strong recommendation without proving an outcome/);
    assert.match(ASSESSMENT_RUBRIC, /Do not invent a causal chain that the intake does not support/);
    // At least one of the worked example pairs stays verbatim so the
    // pattern-connection shape doesn't drift into generic consultant speak.
    assert.match(ASSESSMENT_RUBRIC, /late invoicing \+ unbilled scope changes/);
    assert.match(ASSESSMENT_RUBRIC, /revenue-capture discipline/);
  });

  it("carries PRIORITY ORDER IS DIFFERENT FROM SEVERITY (2026-10-17 round-4 directive)", () => {
    // Severity ≠ priority order. Multiple HIGH-severity findings may
    // coexist and should be ordered by what the owner should look at
    // first — NOT re-leveled down to MEDIUM for visual variety.
    assert.match(ASSESSMENT_RUBRIC, /PRIORITY ORDER IS DIFFERENT FROM SEVERITY/);
    assert.match(ASSESSMENT_RUBRIC, /Severity describes how materially the signal may affect the business/);
    assert.match(ASSESSMENT_RUBRIC, /What would I have the owner look at first/);
    assert.match(ASSESSMENT_RUBRIC, /Multiple findings may legitimately be HIGH severity/);
    assert.match(ASSESSMENT_RUBRIC, /Do NOT lower a finding to MEDIUM merely to create visual variety/);
    assert.match(ASSESSMENT_RUBRIC, /sort the gaps array in the order the owner should address or\s+clarify them/);
    assert.match(ASSESSMENT_RUBRIC, /The first finding should be the one Miguel would start with on the call/);
  });

  it("anchors FREE-TIER FINANCIAL VISIBILITY to the owner's actual answer (2026-10-17 round-3 directive)", () => {
    // The replacement block uses the bank-balance answer as the anchor
    // and explicitly bans four over-claims the previous hard-coded line
    // was quietly licensing.
    assert.match(ASSESSMENT_RUBRIC, /FINANCIAL VISIBILITY ON THE FREE TIER/);
    assert.match(ASSESSMENT_RUBRIC, /The bank-balance question is one of Miguel's core diagnostic questions/);
    assert.match(ASSESSMENT_RUBRIC, /Anchor the finding to what the owner actually said/);
    assert.match(ASSESSMENT_RUBRIC, /somewhere between the actual numbers\s+and what's in the bank account/);
    assert.match(ASSESSMENT_RUBRIC, /A bank balance shows what is there today/);
    assert.match(ASSESSMENT_RUBRIC, /Do NOT claim the books are stale, KPIs are missing, reports are inaccurate,\s+or cash flow is weak unless another answer establishes that/);
    // Hard regression bar: the discarded hard-coded sentence must stay out.
    assert.doesNotMatch(ASSESSMENT_RUBRIC, /You know several important numbers, but\s+decisions are not consistently being made from clean financials and a complete KPI\s+picture/);
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
  it("free tier carries the approved customer-directive block (2026-10-17 round-5 directive)", () => {
    // Section headers from the approved rewrite — PURPOSE / FINDINGS /
    // STRENGTH / OPPORTUNITIES / FINANCIAL VISIBILITY / DEBT / ACTION /
    // BOUNDARY / STYLE / FREE HEALTH CHECK COMPLETENESS CONTRACT.
    assert.match(TIER_GUIDE.free, /FREE BUSINESS HEALTH CHECK/);
    assert.match(TIER_GUIDE.free, /^PURPOSE$/m);
    assert.match(TIER_GUIDE.free, /^FINDINGS$/m);
    assert.match(TIER_GUIDE.free, /^STRENGTH$/m);
    assert.match(TIER_GUIDE.free, /^OPPORTUNITIES$/m);
    assert.match(TIER_GUIDE.free, /^FINANCIAL VISIBILITY$/m);
    assert.match(TIER_GUIDE.free, /^DEBT$/m);
    assert.match(TIER_GUIDE.free, /^ACTION$/m);
    assert.match(TIER_GUIDE.free, /^BOUNDARY$/m);
    assert.match(TIER_GUIDE.free, /^STYLE$/m);
    assert.match(TIER_GUIDE.free, /FREE HEALTH CHECK COMPLETENESS CONTRACT/);

    // Core promises the block replaces older, overbroad language with:
    // economic-mechanism rule, honest uncertainty allowance, severity vs
    // action order split, no em dashes, allowed classification.
    assert.match(TIER_GUIDE.free, /Tie each opportunity to an economic mechanism/);
    assert.match(TIER_GUIDE.free, /revenue capture, margin, cash timing, capacity, concentration, recurring\s+revenue, cost, or decision quality/);
    assert.match(TIER_GUIDE.free, /Severity and action order are different/);
    assert.match(TIER_GUIDE.free, /A strength is evidence, not flattery/);
    assert.match(TIER_GUIDE.free, /Managed debt in good standing is not distress/);
    assert.match(TIER_GUIDE.free, /No em dashes/);
    assert.match(TIER_GUIDE.free, /No digital presence \/ GBP \/ reviews \/ SEO/);
    assert.match(TIER_GUIDE.free, /Truthful uncertainty or non-applicability is a VALID response/);
    assert.match(TIER_GUIDE.free, /Do not penalize the owner for honestly saying they do not know/);
    assert.match(TIER_GUIDE.free, /growth, needs-attention, or rehab/);

    // Hard regression bar: the overbroad "tie opportunities to real money"
    // line from the previous block must stay out — replaced by the
    // economic-mechanism rule above.
    assert.doesNotMatch(TIER_GUIDE.free, /Tie opportunities to real money, capacity, risk, or growth potential/);
  });

  it("server-side intake-completeness gate requires all 11 Q1-Q11 on the free tier", () => {
    // The browser enforces Q1-Q11 at the input layer; the server gate
    // backs that up. Any legitimate current free submission has 11
    // answers, so the floor matches that count. If this ever reads back
    // as 3 again, the browser contract has quietly broken.
    assert.equal(INTAKE_MIN_ANSWERS.free, 11);
  });

  it("paid_47 carries the paid47-v2 contract block (tierGuideVersion paid47-2.0)", () => {
    // Section headers from the paid47-v2 rewrite — PURPOSE / VERSION
    // TAGS / OUTPUT CONTRACT / EVIDENCE RULES / PRIORITY ORDER /
    // SYNTHESIS / FINANCIAL IMPACT / FINANCIAL VISIBILITY / DEBT /
    // FULL DIAGNOSTIC BOUNDARY / NEXT STEP / VOICE.
    assert.match(TIER_GUIDE.paid_47, /\$47 FULL DIAGNOSTIC/);
    assert.match(TIER_GUIDE.paid_47, /tierGuideVersion:\s*paid47-2\.0/);
    assert.match(TIER_GUIDE.paid_47, /^PURPOSE$/m);
    assert.match(TIER_GUIDE.paid_47, /^VERSION TAGS \(MANDATORY\)$/m);
    assert.match(TIER_GUIDE.paid_47, /^OUTPUT CONTRACT$/m);
    assert.match(TIER_GUIDE.paid_47, /^EVIDENCE RULES$/m);
    assert.match(TIER_GUIDE.paid_47, /^PRIORITY ORDER$/m);
    assert.match(TIER_GUIDE.paid_47, /^SYNTHESIS$/m);
    assert.match(TIER_GUIDE.paid_47, /^FINANCIAL IMPACT$/m);
    assert.match(TIER_GUIDE.paid_47, /^FINANCIAL VISIBILITY$/m);
    assert.match(TIER_GUIDE.paid_47, /^DEBT$/m);
    assert.match(TIER_GUIDE.paid_47, /^FULL DIAGNOSTIC BOUNDARY$/m);
    assert.match(TIER_GUIDE.paid_47, /^NEXT STEP$/m);
    assert.match(TIER_GUIDE.paid_47, /^VOICE$/m);

    // v2 schema + guide version tags locked in verbatim — the response
    // quality gate matches these exact strings.
    assert.match(TIER_GUIDE.paid_47, /reportSchemaVersion:\s*"paid47-v2"/);
    assert.match(TIER_GUIDE.paid_47, /tierGuideVersion:\s*"paid47-2\.0"/);

    // v2 output shape — the enriched sections every $47 run must emit.
    assert.match(TIER_GUIDE.paid_47, /financialSnapshot/);
    assert.match(TIER_GUIDE.paid_47, /relatedFindingIds/);
    assert.match(TIER_GUIDE.paid_47, /connections\[\]/);
    assert.match(TIER_GUIDE.paid_47, /questionsToClarify/);
    assert.match(TIER_GUIDE.paid_47, /decisionOrder/);
    assert.match(TIER_GUIDE.paid_47, /coverage\{\}/);

    // Marisol discipline: a primary gap grounded only in an
    // opportunity flag is rejected. \s+ is used for every inter-word
    // boundary so prose that wraps across a newline (as it does on the
    // trimmed paid47-2.0 TIER_GUIDE) still matches.
    assert.match(TIER_GUIDE.paid_47, /primary\s+gap\s+whose\s+ONLY\s+evidence\s+is\s+of\s+type\s+"opportunity_flag"\s+is\s+rejected/);
    assert.match(TIER_GUIDE.paid_47, /merchant-processing\s+flag\s+is\s+a\s+hint\s+toward\s+an\s+opportunity,\s+not\s+a\s+primary\s+diagnostic/);

    // Core promises the block locks in. \s+ is used for inter-word
    // boundaries so prose that wraps across a newline still matches
    // (the trimmed paid47-2.0 TIER_GUIDE word-wraps aggressively).
    assert.match(TIER_GUIDE.paid_47, /Do\s+not\s+manufacture\s+a\s+third\s+gap\s+simply\s+to\s+hit\s+the\s+count/);
    assert.match(TIER_GUIDE.paid_47, /Severity\s+and\s+priority\s+order\s+are\s+different/);
    assert.match(TIER_GUIDE.paid_47, /Do\s+not\s+analyze\s+each\s+answer\s+in\s+isolation/);
    assert.match(TIER_GUIDE.paid_47, /Do\s+not\s+invent\s+ROI/);
    assert.match(TIER_GUIDE.paid_47, /Do\s+not\s+use\s+debt\s+existence\s+alone\s+as\s+evidence\s+of\s+distress/);
    // The included 30-min strategist review is the primary next step —
    // NOT the BGA purchase CTA.
    assert.match(TIER_GUIDE.paid_47, /INCLUDED\s+30-minute\s+CFO\s+By\s+Design\s+strategist\s+review/);
    assert.match(TIER_GUIDE.paid_47, /Do\s+not\s+make\s+the\s+Business\s+Growth\s+Analysis\s+purchase\s+the\s+primary\s+CTA\s+inside\s+the\s+Full\s+Diagnostic\s+report/);
    // Full Diagnostic boundary — not the BGA, not a 90-day plan, not
    // CFO fractional-service recommendations.
    assert.match(TIER_GUIDE.paid_47, /not\s+the\s+Business\s+Growth\s+Analysis/);
    assert.match(TIER_GUIDE.paid_47, /not\s+a\s+complete\s+implementation\s+roadmap/);
    assert.match(TIER_GUIDE.paid_47, /pretend\s+verified\s+financial\s+documents\s+were\s+reviewed\s+when\s+they\s+were\s+not/);
    assert.match(TIER_GUIDE.paid_47, /growth,\s+needs-attention,\s+or\s+rehab/);

    // Hard regression bar: the discarded "synthesize the complete
    // picture" one-liner must stay out.
    assert.doesNotMatch(TIER_GUIDE.paid_47, /go beyond identifying signals and synthesize the complete picture/);
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
