// Phase 2D: HTML renderer consumes structured_findings.
//
// buildReportHtml must:
//   - prefer agent.structured_findings when the array has entries,
//   - fall back to agent.gaps (prose) when structured is empty / absent,
//   - render a "Based on:" receipts footer carrying evidence +
//     derived_metrics in human-friendly form,
//   - map severity ∈ {low, medium, high} to a priority badge + color,
//   - leave opportunities (prose) untouched.
//
// GHL writeback contracts, /report reads, and buildReportPage shell are
// unchanged — this suite just exercises the HTML body builder.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildReportHtml } from "../src/index.js"; // re-exported

// Minimal agent fixture — a path/badge/headline shell plus one or two
// slots we flip between prose and structured.
const SHELL = {
  path: "needs-attention",
  badge: "NEEDS ATTENTION",
  headline: "Headline.",
  opener: "Opener.",
  context: "Context.",
  nextStepHeadline: "Next step",
  nextStepBody: "Body.",
  opportunityFlags: [],
};

const PROSE_GAP = { title: "Prose gap", impact: "Prose impact.", priority: "HIGH" };
const PROSE_OPP = { title: "Prose opp",  desc: "Prose desc.", impact: "Prose tag" };

const STRUCTURED_FINDING = {
  finding_id: "ar-aging-001",
  category: "cash_flow",
  severity: "high",
  evidence: [
    { field: "ar_60_plus", value: 6500 },
    { field: "monthly_debt_service", value: 1800 },
  ],
  derived_metrics: [
    { metric: "ar_60_plus_months_of_debt_service", value: 3.61, unit: "months" },
  ],
  interpretation: "Meaningfully aged receivables may be adding avoidable cash-flow pressure.",
  recommendation: "Improve collection cadence before assuming additional expansion debt.",
};

// --- fallback discipline ------------------------------------------------

describe("buildReportHtml — fallback to prose when structured is absent/empty", () => {
  it("renders prose gaps when structured_findings is undefined", () => {
    const html = buildReportHtml({ ...SHELL, gaps: [PROSE_GAP], opportunities: [PROSE_OPP] });
    assert.ok(html.includes("Prose gap"));
    assert.ok(html.includes("Prose impact"));
    assert.ok(html.includes("HIGH"));
    assert.ok(!html.includes("Based on:"), "no receipts row on the prose path");
  });

  it("renders prose gaps when structured_findings is an empty array", () => {
    const html = buildReportHtml({
      ...SHELL,
      gaps: [PROSE_GAP],
      opportunities: [PROSE_OPP],
      structured_findings: [],
    });
    assert.ok(html.includes("Prose gap"));
    assert.ok(!html.includes("Based on:"));
  });
});

// --- structured preferred ----------------------------------------------

describe("buildReportHtml — prefers structured_findings when present", () => {
  it("renders interpretation + recommendation from the structured finding", () => {
    const html = buildReportHtml({
      ...SHELL,
      gaps: [PROSE_GAP], // present but should NOT be used
      opportunities: [PROSE_OPP],
      structured_findings: [STRUCTURED_FINDING],
    });
    assert.ok(html.includes(STRUCTURED_FINDING.interpretation),
      "structured interpretation must appear in output");
    assert.ok(html.includes(STRUCTURED_FINDING.recommendation),
      "structured recommendation must appear in output");
    // The prose gap must NOT be shown — the structured path replaces it.
    assert.ok(!html.includes("Prose gap"),
      "when structured findings exist, prose gaps are not rendered");
    assert.ok(!html.includes("Prose impact"));
  });

  it("renders the 'Based on:' receipts footer with field + metric labels", () => {
    const html = buildReportHtml({
      ...SHELL,
      opportunities: [PROSE_OPP],
      structured_findings: [STRUCTURED_FINDING],
    });
    assert.ok(html.includes("Based on:"), "receipts row must be present");
    assert.ok(html.includes("A/R 60+ days: $6,500"), "A/R 60+ formatted with $ + commas");
    assert.ok(html.includes("Monthly debt service: $1,800"), "monthly debt service formatted");
    assert.ok(html.includes("Months of debt service in 60+ A/R: 3.61 months"),
      "metric rendered with human label + value + unit suffix");
  });

  it("maps severity high → HIGH badge with red color", () => {
    const html = buildReportHtml({
      ...SHELL,
      opportunities: [PROSE_OPP],
      structured_findings: [{ ...STRUCTURED_FINDING, severity: "high" }],
    });
    assert.ok(html.includes(">HIGH<"));
    assert.ok(html.includes("#b91c1c"), "high severity renders in #b91c1c");
  });

  it("maps severity medium → MEDIUM badge with amber color", () => {
    const html = buildReportHtml({
      ...SHELL,
      opportunities: [PROSE_OPP],
      structured_findings: [{ ...STRUCTURED_FINDING, severity: "medium" }],
    });
    assert.ok(html.includes(">MEDIUM<"));
    assert.ok(html.includes("#d97706"));
  });

  it("maps severity low → LOW badge", () => {
    const html = buildReportHtml({
      ...SHELL,
      opportunities: [PROSE_OPP],
      structured_findings: [{ ...STRUCTURED_FINDING, severity: "low" }],
    });
    assert.ok(html.includes(">LOW<"));
  });

  it("omits the receipts row when a finding has no evidence or metrics", () => {
    // A grounded-in-nothing finding wouldn't pass validation and shouldn't
    // reach the renderer. But even if a well-formed finding has no
    // receipts to show (hypothetically), the row must not appear
    // with "Based on: " and an empty payload.
    const html = buildReportHtml({
      ...SHELL,
      opportunities: [PROSE_OPP],
      structured_findings: [{
        finding_id: "x", category: "cash_flow", severity: "medium",
        evidence: [], derived_metrics: [],
        interpretation: "x", recommendation: "y",
      }],
    });
    assert.ok(!html.includes("Based on: "), "no receipts row when both arrays are empty");
  });

  it("renders a ratio metric as a percentage", () => {
    const html = buildReportHtml({
      ...SHELL,
      opportunities: [PROSE_OPP],
      structured_findings: [{
        finding_id: "funnel-001",
        category: "revenue",
        severity: "medium",
        evidence: [],
        derived_metrics: [{ metric: "lead_to_sale_rate", value: 0.0133, unit: "ratio" }],
        interpretation: "Lead-to-sale conversion rate is thin.",
        recommendation: "Investigate pipeline leakage.",
      }],
    });
    assert.ok(html.includes("Lead → sale rate: 1.3%"),
      "ratio values render as percentage with one decimal");
  });

  it("renders a dollar-unit metric as $-prefixed", () => {
    const html = buildReportHtml({
      ...SHELL,
      opportunities: [PROSE_OPP],
      structured_findings: [{
        finding_id: "debt-001",
        category: "debt",
        severity: "medium",
        evidence: [],
        derived_metrics: [{ metric: "total_debt", value: 60000, unit: "dollars" }],
        interpretation: "Debt load is meaningful at this stage.",
        recommendation: "Model service against monthly operating cash.",
      }],
    });
    assert.ok(html.includes("Total debt: $60,000"),
      "dollar-unit metrics render with $ + commas");
  });

  it("renders boolean evidence as yes/no", () => {
    const html = buildReportHtml({
      ...SHELL,
      opportunities: [PROSE_OPP],
      structured_findings: [{
        finding_id: "fv-001",
        category: "cash_flow",
        severity: "medium",
        evidence: [{ field: "has_documented_budget", value: false }],
        derived_metrics: [],
        interpretation: "Decisions are being made without a documented financial plan.",
        recommendation: "Establish a budget before Q4.",
      }],
    });
    assert.ok(html.includes("Documented budget: no"),
      "booleans render as yes/no, not true/false");
  });
});

// --- opportunities section stays prose ---------------------------------

describe("buildReportHtml — opportunities continue to render from prose", () => {
  it("renders opportunities from agent.opportunities even when structured_findings present", () => {
    const html = buildReportHtml({
      ...SHELL,
      gaps: [],
      opportunities: [PROSE_OPP],
      structured_findings: [STRUCTURED_FINDING],
    });
    assert.ok(html.includes("Prose opp"));
    assert.ok(html.includes("Prose desc"));
    assert.ok(html.includes("Prose tag"));
  });
});
