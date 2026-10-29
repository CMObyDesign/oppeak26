// FREE REPORT RENDERING CONTRACT regression tests (2026-10-29).
//
// Backed by worker/tests/fixtures/shankar_dental_free_q1_q11.json —
// a fixture produced from ONLY the 11 answers the current Free
// Business Health Check actually collects (Q1-Q11). It replaces the
// prior liz_free_v1_legacy.json for free-tier semantic-regression
// coverage: that older fixture contained financial fields the current
// intake does not ask for.
//
// These tests lock the eleven invariants from the spec's "FREE REPORT
// RENDERING CONTRACT" block + the paid_47-aware TIER_GUIDE rules
// (Section Role / Non-Repetition, Memorable Thesis, The Gap, One Move,
// Strength non-empty, decision-basis Q5 handling, no em dashes in
// customer-facing output).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildReportHtml } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(
    join(__dirname, "fixtures", "shankar_dental_free_q1_q11.json"),
    "utf8",
  ),
);

// Fields the renderer surfaces to the customer. Non-customer-facing
// fields (opportunityFlags, strategistBrief, structured_findings) are
// excluded — those can carry working notes that may contain em dashes
// without appearing in the owner's view.
function customerFacingText(agent) {
  const parts = [
    agent.badge, agent.headline, agent.opener, agent.context,
    agent.nextStepHeadline, agent.nextStepBody,
  ];
  if (agent.strength) parts.push(agent.strength.title, agent.strength.desc);
  if (agent.oneMove) parts.push(agent.oneMove.title, agent.oneMove.desc);
  if (agent.theGap) {
    parts.push(agent.theGap.known, agent.theGap.unknown, agent.theGap.whyItMatters, agent.theGap.whatPaidWillInvestigate);
  }
  for (const g of agent.gaps || []) parts.push(g.title, g.impact);
  for (const o of agent.opportunities || []) parts.push(o.title, o.desc, o.impact);
  return parts.filter(Boolean).join("\n");
}

describe("FREE REPORT RENDERING CONTRACT — fixture: shankar_dental_free_q1_q11", () => {
  it("supported Strength is not blank", () => {
    assert.ok(fixture.strength, "fixture must carry a strength object when supported");
    assert.ok(fixture.strength.title && String(fixture.strength.title).trim(), "strength.title must be non-empty");
    assert.ok(fixture.strength.desc && String(fixture.strength.desc).trim(), "strength.desc must be non-empty");
  });

  it("Snapshot text is not verbatim duplicated in detailed findings", () => {
    // Fuzzy duplication check: if the opener/context sentence appears
    // verbatim as a gap.impact or opportunity.desc, that's the exact
    // bug (same paragraph in two sections). Normalize whitespace +
    // lowercase before comparing so trivial formatting diffs don't
    // false-positive.
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const snapshotStrings = [norm(fixture.opener), norm(fixture.context)];
    const detailedStrings = [
      ...(fixture.gaps || []).map((g) => norm(g.impact)),
      ...(fixture.opportunities || []).map((o) => norm(o.desc)),
    ];
    for (const snap of snapshotStrings) {
      if (!snap) continue;
      for (const det of detailedStrings) {
        if (!det) continue;
        assert.notEqual(snap, det, `snapshot text "${snap.slice(0, 60)}…" is duplicated verbatim in a gap/opportunity`);
      }
    }
  });

  it("2 findings is valid (gaps.length === 2 passes with no filler third)", () => {
    assert.ok(Array.isArray(fixture.gaps));
    assert.ok(fixture.gaps.length >= 1 && fixture.gaps.length <= 3, "gaps must be 1-3");
    // Specifically: this fixture carries exactly 2 gaps to lock the
    // "two findings is valid" invariant. If this ever grows a third,
    // the fixture is being padded.
    assert.equal(fixture.gaps.length, 2, "fixture should hold exactly 2 gaps to lock 'two findings is valid'");
  });

  it("HIGH + HIGH is valid (same severity across findings is allowed)", () => {
    const priorities = fixture.gaps.map((g) => g.priority);
    assert.ok(priorities.every((p) => ["CRITICAL", "HIGH", "MEDIUM"].includes(p)), "all priorities must be in the allowed enum");
    // This fixture carries HIGH + HIGH. The contract allows multiple
    // findings to share the same severity; the test asserts the
    // response is accepted as-is (same-severity is not a bug).
    assert.deepEqual(priorities, ["HIGH", "HIGH"], "fixture should hold HIGH + HIGH to lock 'same severity is valid'");
  });

  it("gaps <= 3", () => {
    assert.ok(fixture.gaps.length <= 3, `gaps.length ${fixture.gaps.length} exceeds the free-tier cap of 3`);
  });

  it("opportunities <= 2", () => {
    assert.ok(Array.isArray(fixture.opportunities));
    assert.ok(fixture.opportunities.length <= 2, `opportunities.length ${fixture.opportunities.length} exceeds the free-tier cap of 2`);
  });

  it("One Free Action renders (oneMove present + non-empty)", () => {
    assert.ok(fixture.oneMove, "oneMove must be present when a first-ranked signal exists");
    assert.ok(fixture.oneMove.title && String(fixture.oneMove.title).trim(), "oneMove.title must be non-empty");
    assert.ok(fixture.oneMove.desc && String(fixture.oneMove.desc).trim(), "oneMove.desc must be non-empty");
    // Render path: buildReportHtml surfaces the block under the
    // "One Move You Can Make Now" header when title is non-empty.
    const html = buildReportHtml(fixture);
    assert.match(html, /One Move You Can Make Now/);
    assert.ok(html.includes(fixture.oneMove.title), "oneMove.title must appear in the rendered HTML");
  });

  it("The Gap contains a personalized unresolved CFO question", () => {
    assert.ok(fixture.theGap, "theGap must be present");
    assert.ok(fixture.theGap.unknown && String(fixture.theGap.unknown).trim(), "theGap.unknown must be non-empty");
    assert.ok(fixture.theGap.whyItMatters && String(fixture.theGap.whyItMatters).trim(), "theGap.whyItMatters must be non-empty");
    assert.ok(fixture.theGap.whatPaidWillInvestigate && String(fixture.theGap.whatPaidWillInvestigate).trim(), "theGap.whatPaidWillInvestigate must be non-empty");
    // Personalization check: the gap must reference something specific
    // to THIS business (business name, service line, decision at hand)
    // — not a generic cash flow / debt / profitability category list.
    const concat = [fixture.theGap.known, fixture.theGap.unknown, fixture.theGap.whyItMatters]
      .join(" ").toLowerCase();
    const genericListPatterns = [
      /^cash flow, debt, profitability, receivables, or growth/,
      /^generic financial advice/,
    ];
    for (const re of genericListPatterns) {
      assert.doesNotMatch(concat, re, "theGap must not open with a generic category list");
    }
    // Must mention the business's actual decision context.
    assert.ok(/oak ridge|expansion|4th location|billings|service line/.test(concat),
      "theGap must reference the specific decision in front of this business");
  });

  it("Q5 = numbers-based decisions may contribute to a Strength", () => {
    // Priya answered Q5 "on actual numbers" (numbers-based). The
    // contract: recognize that as a strength when supported. The
    // fixture's strength + opener both reflect that; this test checks
    // the fixture didn't fall into the opposite bug (manufacturing a
    // visibility gap when the owner's answer is strong).
    const concat = [
      fixture.strength?.title || "",
      fixture.strength?.desc || "",
      fixture.opener || "",
    ].join(" ").toLowerCase();
    // Should surface the numbers-based decision process as a strength.
    assert.ok(/numbers|decision/.test(concat),
      "fixture should recognize Priya's numbers-based decision process in the strength narrative");
    // Should NOT manufacture a visibility gap on a numbers-based answer.
    for (const g of fixture.gaps) {
      const gText = (g.title + " " + g.impact).toLowerCase();
      assert.doesNotMatch(gText, /bank balance.*decision basis is weak|financial visibility is poor|no clear decision process/,
        `gap "${g.title}" invented a visibility gap on a numbers-based Q5 answer`);
    }
  });

  it("Q5 = bank-balance/in-between answer may contribute to a visibility finding (sibling fixture scenario)", () => {
    // This fixture answers Q5 as numbers-based so a visibility finding
    // is NOT expected here. The sibling-scenario check: simulate a
    // mutation where Q5 drives a visibility pattern and confirm the
    // fixture's finding-structure permits one.
    //
    // We assert the schema allows a visibility-themed gap: the fixture
    // can emit a gap whose title/impact references bank-balance or
    // financial-visibility language. The real negative test (Q5-based
    // visibility finding emits correctly) belongs on the live prompt;
    // here we validate structural tolerance.
    const mutated = structuredClone(fixture);
    mutated.gaps.push({
      title: "Financial decisions still partly ride on the bank balance",
      impact: "You said decisions come from the actual numbers, but the Oak Ridge move will need forward-looking cash visibility the current reporting cadence does not provide.",
      priority: "MEDIUM",
    });
    assert.ok(mutated.gaps.length <= 3, "mutated fixture must still respect gaps<=3");
    // Validate structural tolerance: the renderer accepts and
    // surfaces a visibility finding without choking.
    const html = buildReportHtml(mutated);
    assert.ok(html.includes("Financial decisions still partly ride on the bank balance"));
  });

  it("customer-facing output contains no em dashes", () => {
    const customerText = customerFacingText(fixture);
    // U+2014 em dash
    const emDashCount = (customerText.match(/—/g) || []).length;
    assert.equal(emDashCount, 0,
      `found ${emDashCount} em dash(es) in customer-facing text; strip them per the no-em-dash rule in TIER_GUIDE.free STYLE`);
    // Also check the rendered HTML customer surface (not the full page
    // wrapper — only the content buildReportHtml produces).
    const html = buildReportHtml(fixture);
    const htmlEmDashCount = (html.match(/—/g) || []).length;
    assert.equal(htmlEmDashCount, 0, `rendered HTML contains ${htmlEmDashCount} em dash(es)`);
  });
});
