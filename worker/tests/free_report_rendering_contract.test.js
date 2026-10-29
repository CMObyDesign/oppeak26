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
  if (agent.contextualInsight) parts.push(agent.contextualInsight.title, agent.contextualInsight.body);
  if (agent.oneMove) parts.push(agent.oneMove.title, agent.oneMove.desc);
  if (agent.theGap) {
    parts.push(agent.theGap.question, agent.theGap.known, agent.theGap.unknown, agent.theGap.whyItMatters, agent.theGap.whatPaidWillInvestigate);
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

  it("contextualInsight renders when present and uses an approved title", () => {
    assert.ok(fixture.contextualInsight, "fixture must carry a contextualInsight when a meaningful connection is supported");
    assert.ok(fixture.contextualInsight.title && String(fixture.contextualInsight.title).trim(), "contextualInsight.title must be non-empty");
    assert.ok(fixture.contextualInsight.body && String(fixture.contextualInsight.body).trim(), "contextualInsight.body must be non-empty");
    const APPROVED_TITLES = new Set([
      "The tension",
      "What I'd watch",
      "That number means",
      "The question I wouldn't ignore",
    ]);
    assert.ok(
      APPROVED_TITLES.has(fixture.contextualInsight.title),
      `contextualInsight.title "${fixture.contextualInsight.title}" is not one of the four approved titles`,
    );
    // 2026-10-29: the generic "Contextual Insight" heading was
    // dropped per Liz; the signature label (The tension / What
    // I'd watch / etc.) now stands on its own as the eyebrow.
    // We assert title AND body appear and the card frame
    // (`border-left:4px solid #92400e`) is present.
    const html = buildReportHtml(fixture);
    assert.doesNotMatch(html, /Contextual Insight/,
      "the generic 'Contextual Insight' heading must not render; the signature label is the eyebrow");
    assert.ok(html.includes(fixture.contextualInsight.title), "contextualInsight.title must appear in the rendered HTML");
    assert.ok(html.includes(fixture.contextualInsight.body), "contextualInsight.body must appear in the rendered HTML");
    assert.match(html, /border-left:4px solid #92400e/,
      "contextualInsight card frame must render (amber accent border)");
  });

  it("no blank contextualInsight shell: missing title OR body suppresses the card entirely", () => {
    // 2026-10-29: without a "Contextual Insight" heading to look
    // for, the card frame is the signal. The amber accent border
    // (`#92400e`) belongs to this block alone, so its absence
    // means the card didn't render; using the body text as a
    // fallback probe handles the empty-title case.
    const APPROVED_TITLES = ["The tension", "What I'd watch", "That number means", "The question I wouldn't ignore"];
    const titleAppears = (html) => APPROVED_TITLES.some((t) => html.includes(t));
    // Missing title
    const noTitle = structuredClone(fixture);
    noTitle.contextualInsight = { title: "", body: "something unique xyz-123" };
    const htmlNoTitle = buildReportHtml(noTitle);
    assert.ok(!htmlNoTitle.includes("something unique xyz-123"),
      "contextualInsight body must not render when title is empty");
    // Missing body
    const noBody = structuredClone(fixture);
    noBody.contextualInsight = { title: "The tension", body: "" };
    const htmlNoBody = buildReportHtml(noBody);
    // "The tension" could appear in other content, so check for the amber-frame
    // card signature right before the title.
    assert.doesNotMatch(htmlNoBody,
      /border-left:4px solid #92400e;[^"]*"[^>]*>\s*<div[^>]*>\s*The tension/,
      "contextualInsight card must not render when body is empty");
    // Entire field absent — amber accent border is this block's signature.
    const noField = structuredClone(fixture);
    delete noField.contextualInsight;
    const htmlNoField = buildReportHtml(noField);
    assert.ok(!titleAppears(htmlNoField) || !/#92400e/.test(htmlNoField.split("The Gap")[0] || htmlNoField),
      "contextualInsight card must not render when the field is absent");
  });

  it("contextualInsight is not verbatim-equal to a gap or opportunity", () => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const ciBody = norm(fixture.contextualInsight?.body);
    const ciTitle = norm(fixture.contextualInsight?.title);
    for (const g of fixture.gaps || []) {
      assert.notEqual(ciBody, norm(g.impact), `contextualInsight.body matches gap.impact "${g.title}" verbatim`);
      assert.notEqual(ciTitle, norm(g.title), `contextualInsight.title matches gap.title "${g.title}" verbatim`);
    }
    for (const o of fixture.opportunities || []) {
      assert.notEqual(ciBody, norm(o.desc), `contextualInsight.body matches opportunity.desc "${o.title}" verbatim`);
      assert.notEqual(ciTitle, norm(o.title), `contextualInsight.title matches opportunity.title "${o.title}" verbatim`);
    }
  });

  it("historical free report WITHOUT contextualInsight still renders", () => {
    const legacy = structuredClone(fixture);
    delete legacy.contextualInsight;
    const html = buildReportHtml(legacy);
    // Core sections still present
    assert.match(html, /Critical Gaps Identified/);
    assert.match(html, /Your Highest-Impact Opportunities/);
    assert.match(html, /One Move You Can Make Now/);
    assert.match(html, /The Gap/);
    // And no "Contextual Insight" shell leaked through
    assert.doesNotMatch(html, /Contextual Insight/);
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

  it("theGap carries a personalized CFO question and renders it ABOVE the four prose fields", () => {
    // Codex P1 on #164: the free report must END with ONE
    // personalized unresolved CFO question. The schema now exposes
    // theGap.question for exactly that; the renderer must put it on
    // top of the known/unknown/why/paid support fields so the
    // reader sees the question first, then the backing.
    assert.ok(fixture.theGap, "fixture must carry theGap");
    assert.ok(fixture.theGap.question && String(fixture.theGap.question).trim(),
      "theGap.question must be non-empty when a personalized CFO question is supported");
    const html = buildReportHtml(fixture);
    const idxQuestion = html.indexOf(fixture.theGap.question);
    const idxKnown = html.indexOf("What we know:");
    assert.ok(idxQuestion >= 0, "theGap.question must appear in rendered HTML");
    assert.ok(idxKnown >= 0, "'What we know:' label must appear in rendered HTML");
    assert.ok(idxQuestion < idxKnown,
      "theGap.question must render BEFORE the 'What we know:' line, not after it");
  });

  it("theGap renders the four prose fields even without a question (backward compat)", () => {
    // Historical reports (pre-2026-10-29) carry only the four prose
    // fields. Dropping the question field must not break those: the
    // card still renders, just without a headline question.
    const legacy = structuredClone(fixture);
    delete legacy.theGap.question;
    const html = buildReportHtml(legacy);
    assert.match(html, /The Gap/);
    assert.match(html, /What we know:/);
    assert.match(html, /What the Full Diagnostic investigates:/);
  });

  it("buildReportHtml strips em dashes at the boundary even when Solomon emits them", () => {
    // Runtime guarantee: even if the model slips an em dash through
    // (which Liz's 2026-10-29 live test caught several times), the
    // renderer normalizes U+2014 to " - " and collapses the extra
    // spacing. This test proves the sanitation path, not the prompt
    // rule — the prompt rule is tested above against the fixture.
    const dirty = structuredClone(fixture);
    dirty.headline = "Decisions ride on cash — and that is costing you clarity";
    dirty.opener = "You are growing—but the gauges have not kept up.";
    dirty.gaps[0].title = "A/R aging — $9k past due";
    const html = buildReportHtml(dirty);
    assert.equal((html.match(/—/g) || []).length, 0,
      "buildReportHtml must strip every em dash from customer-facing fields");
    // And the rewrites preserve the sentence meaning.
    assert.match(html, /Decisions ride on cash - and that is costing you clarity/);
    assert.match(html, /You are growing - but the gauges have not kept up\./);
    assert.match(html, /A\/R aging - \$9k past due/);
  });
});
