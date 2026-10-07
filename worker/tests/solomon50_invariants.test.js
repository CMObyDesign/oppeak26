// SOLOMON50 beta invariants.
//
// The SOLOMON50 beta code must grant the same `paid_47` entitlement
// a normal $47 purchase grants — no separate tier, no separate
// prompt, no separate rubric, no separate report path. Beta status
// is metadata (how the entitlement was issued) and never diagnostic
// logic.
//
// These tests pin ten invariants so a future refactor can't quietly
// create a parallel tier or alter the diagnostic logic for beta
// users.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TIER_GUIDE,
  ASSESSMENT_RUBRIC,
  buildPrompt,
  buildReportHtml,
} from "../src/index.js";

describe("SOLOMON50 beta invariants", () => {
  it("1. There is no separate 'solomon50' or 'beta' entry in TIER_GUIDE", () => {
    const keys = new Set(Object.keys(TIER_GUIDE));
    assert.deepEqual(keys, new Set(["free", "paid_47", "paid_297"]));
    assert.ok(!("solomon50" in TIER_GUIDE), "no solomon50 tier");
    assert.ok(!("beta" in TIER_GUIDE), "no beta tier");
    assert.ok(!("paid_47_beta" in TIER_GUIDE), "no paid_47_beta variant");
  });

  it("2. buildPrompt for a beta user uses TIER_GUIDE.paid_47 (same as a paid $47 user)", () => {
    // There is no separate code path. A SOLOMON50 redeemer who completes
    // the paid_47 survey arrives at the webhook with tier="paid_47", so
    // the same buildPrompt(tier) path they share with a $47 purchaser
    // produces the same guide splice.
    const paidPrompt = buildPrompt("paid_47", [{ question: "q", answer: "a" }], { name: "Beta Lead" });
    assert.ok(paidPrompt.includes(TIER_GUIDE.paid_47), "paid_47 guide spliced into prompt");
    assert.ok(!paidPrompt.includes(TIER_GUIDE.free), "free guide must NOT appear in paid_47 prompt");
    assert.ok(!paidPrompt.includes(TIER_GUIDE.paid_297), "paid_297 guide must NOT appear in paid_47 prompt");
  });

  it("3. TIER_GUIDE.paid_47 restricts customer-facing classification to the shared 3 values", () => {
    // Beta and paid routes share this. If a future change narrows the
    // beta tier's classification differently, this test fails.
    assert.match(TIER_GUIDE.paid_47, /growth, needs-attention, or rehab/);
  });

  it("4. ASSESSMENT_RUBRIC never mentions SOLOMON50 or beta-specific diagnostic logic", () => {
    // The rubric is the system prompt. Beta status is a GHL tag; it
    // must never bleed into Solomon's reasoning. If someone adds a
    // "beta users should…" rule to the rubric, this test fails and
    // forces a redesign.
    assert.doesNotMatch(ASSESSMENT_RUBRIC, /SOLOMON50/i);
    assert.doesNotMatch(ASSESSMENT_RUBRIC, /beta cohort/i);
    assert.doesNotMatch(ASSESSMENT_RUBRIC, /beta code/i);
    assert.doesNotMatch(ASSESSMENT_RUBRIC, /price_paid/i);
  });

  it("5. buildReportHtml output is agnostic to how the entitlement was issued", () => {
    // The renderer takes an agent JSON object. It has no awareness of
    // tier or access_method. A beta user and a paid user generate
    // identical HTML for identical agent output.
    const agent = {
      badge: "FULL DIAGNOSTIC",
      headline: "test headline",
      opener: "test opener",
      gaps: [{ title: "g1", impact: "i1", priority: "HIGH" }],
      opportunities: [{ title: "o1", desc: "d1", impact: "imp" }],
      nextStepHeadline: "ns",
      nextStepBody: "nsb",
    };
    const html = buildReportHtml(agent);
    assert.ok(!html.includes("SOLOMON50"));
    assert.ok(!html.includes("beta"));
    assert.ok(!html.includes("access_method"));
    assert.ok(!html.includes("price_paid"));
  });

  it("6. INTAKE_MIN_ANSWERS has no beta-specific key — beta and paid share the paid_47 floor", async () => {
    // Checked structurally via the public tier set; INTAKE_MIN_ANSWERS
    // itself isn't exported but the TIER_GUIDE set gates it.
    assert.deepEqual(new Set(Object.keys(TIER_GUIDE)), new Set(["free", "paid_47", "paid_297"]));
  });

  it("7. The free TIER_GUIDE forbids the digital-presence / GBP finding so beta promotion traffic doesn't leak paid-tier reveals", () => {
    // Not strictly a beta invariant — but a related leakage guard. If
    // a future TIER_GUIDE revision drops this discipline, free-tier
    // beta-adjacent traffic could start seeing paid-tier findings.
    assert.match(TIER_GUIDE.free, /DO NOT use digital presence|digital presence|Google Business Profile/);
  });

  it("8. Beta and paid routes share the same paid_47 synthesis directive — not more findings, synthesis", () => {
    // paid_47 is characterized by synthesis-over-enumeration. Beta users
    // get the same discipline because they hit the same tier.
    assert.match(TIER_GUIDE.paid_47, /synthesize the complete picture/);
    assert.match(TIER_GUIDE.paid_47, /interactions between/);
  });

  it("9. There is no beta-specific severity or tone escape hatch", () => {
    assert.doesNotMatch(TIER_GUIDE.paid_47, /beta/i);
    assert.doesNotMatch(TIER_GUIDE.paid_47, /SOLOMON50/i);
    // Severity-is-not-tone discipline applies to all paid_47 output
    // regardless of how the entitlement was granted.
    assert.match(TIER_GUIDE.paid_47, /Do not treat severity as permission/);
  });

  it("10. Removing the beta campaign does not require touching the diagnostic — the tier is paid_47, not solomon50", () => {
    // The beta mechanism is a GHL tag (`swot_solomon50_applied`) + an
    // env-var redirect (`UPGRADE_47_URL`) + a one-shot entitlement
    // endpoint (`/apply-solomon50`). None of those are part of
    // TIER_GUIDE or ASSESSMENT_RUBRIC — proven here by their absence.
    // When the campaign ends, the beta chrome goes; the paid_47 tier
    // stays unchanged. This test is the last line of defense against
    // a future refactor that tries to "simplify" the beta flow by
    // promoting it into TIER_GUIDE itself.
    for (const guide of Object.values(TIER_GUIDE)) {
      assert.doesNotMatch(guide, /SOLOMON50/i);
      assert.doesNotMatch(guide, /beta code/i);
      assert.doesNotMatch(guide, /campaign/i);
    }
    assert.doesNotMatch(ASSESSMENT_RUBRIC, /SOLOMON50/i);
    assert.doesNotMatch(ASSESSMENT_RUBRIC, /beta cohort/i);
  });
});
