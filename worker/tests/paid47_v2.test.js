// paid47-v2 response quality gate tests.
//
// The gate validates every $47 Full Diagnostic response against the
// enriched contract. Deficiencies trigger one regeneration; a second
// failure downgrades to the legacy renderer. These tests cover the
// invariants that have to stay true for the owner's $47 to produce a
// trustworthy report.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  claimsPaid47V2,
  validatePaid47V2,
  buildRegenerationNudge,
} from "../src/paid47_v2.js";

// Minimal valid paid47-v2 agent response — all tests mutate from
// this baseline to isolate the rule under test.
function baseAgent() {
  return {
    reportSchemaVersion: "paid47-v2",
    tierGuideVersion: "paid47-2.0",
    path: "needs-attention",
    badge: "FULL DIAGNOSTIC",
    headline: "Headline",
    opener: "Opener.",
    context: "Context.",
    financialSnapshot: [
      { label: "Monthly debt service", value: "$850", meaning: "", sourceType: "customer_answer" },
    ],
    gaps: [
      {
        id: "ar-aging",
        title: "A/R aging drifting older",
        priority: "HIGH",
        evidence: [{ type: "derived_metric", key: "ar_60_plus_months_of_debt_service" }],
        known: "9k of 28k overdue A/R is 60+ days.",
        diagnosis: "Collections are not keeping up.",
        whyItMatters: "That's months of debt service tied up as receivables.",
        unknown: "none",
        decisionImplication: "Prioritize collections before adding payroll.",
        relatedFindingIds: ["pricing"],
      },
      {
        id: "growth-supportability",
        title: "Growth outpacing cash discipline",
        priority: "HIGH",
        evidence: [{ type: "answer", key: "financial_decision_basis" }],
        known: "Decisions made from bank balance.",
        diagnosis: "Visibility is the bottleneck.",
        whyItMatters: "Scaling without a monthly close invites surprises.",
        unknown: "What the actual close cadence is.",
        decisionImplication: "Monthly close before next hire.",
      },
      {
        id: "pricing",
        title: "Pricing not aligned with cost base",
        priority: "MEDIUM",
        evidence: [{ type: "answer", key: "financial_decision_basis" }],
        known: "No formal cost build-up.",
        diagnosis: "Margins at risk.",
        whyItMatters: "Each new job may be unprofitable.",
        unknown: "True gross margin.",
        decisionImplication: "Rebuild pricing from costs before growth.",
      },
    ],
    opportunities: [
      {
        id: "collections-cycle",
        title: "Tighten collections cycle",
        evidence: [{ type: "derived_metric", key: "ar_60_plus_months_of_debt_service" }],
        whyCredible: "9k of 28k is already 60+ days — a measured aging problem.",
        economicMechanism: "cash timing",
        whatMustBeTrue: "A/R staff has time to run 30/60/90 outreach.",
        nextValidation: "One week of outreach-outcome logging.",
      },
    ],
    connections: [
      {
        title: "Pricing + visibility drive the AR drag",
        findingIds: ["ar-aging", "pricing"],
        explanation: "Weak pricing shrinks margin while weak visibility delays follow-up.",
      },
    ],
    questionsToClarify: [{ question: "What's the current close cadence?", whyItMatters: "Unblocks growth-supportability." }],
    decisionOrder: [{ step: 1, action: "Lock monthly close.", whyNow: "Prerequisite for everything else." }],
    coverage: {
      gapsRequested: 3,
      gapsReturned: 3,
      gapsShortfallReason: null,
      opportunitiesRequested: 2,
      opportunitiesReturned: 1,
      opportunitiesShortfallReason: "Only one opportunity had evidence.",
      connectionStatus: "identified",
      noConnectionReason: null,
    },
    nextStepHeadline: "Book your included 30-minute strategist review.",
    nextStepBody: "Miguel will walk through the three gaps and the open question.",
    opportunityFlags: [],
  };
}

const CONTEXT = {
  validFactKeys: new Set(["financial_decision_basis", "ar_60_plus", "ar_30_plus", "monthly_debt_service"]),
  validMetricNames: new Set(["ar_60_plus_months_of_debt_service", "ar_30_plus_months_of_debt_service", "annual_debt_service"]),
};

describe("claimsPaid47V2", () => {
  it("accepts the canonical pair", () => {
    assert.equal(claimsPaid47V2({ reportSchemaVersion: "paid47-v2", tierGuideVersion: "paid47-2.0" }), true);
  });
  it("rejects anything else", () => {
    assert.equal(claimsPaid47V2({}), false);
    assert.equal(claimsPaid47V2({ reportSchemaVersion: "paid47-v2" }), false);
    assert.equal(claimsPaid47V2({ reportSchemaVersion: "paid47-v3", tierGuideVersion: "paid47-2.0" }), false);
    assert.equal(claimsPaid47V2(null), false);
  });
});

describe("validatePaid47V2", () => {
  it("passes on a complete baseline response", () => {
    const r = validatePaid47V2(baseAgent(), CONTEXT);
    assert.equal(r.ok, true, JSON.stringify(r.deficiencies));
    assert.equal(r.isV2, true);
  });

  it("fails fast when version tags are missing", () => {
    const a = baseAgent();
    delete a.reportSchemaVersion;
    const r = validatePaid47V2(a, CONTEXT);
    assert.equal(r.ok, false);
    assert.equal(r.isV2, false);
    assert.equal(r.deficiencies[0].code, "MISSING_VERSION_TAGS");
  });

  it("rejects a primary gap grounded only in an opportunity flag (Marisol discipline)", () => {
    const a = baseAgent();
    a.opportunityFlags = ["MERCHANT_PROCESSING_OPP"];
    a.gaps[0].evidence = [{ type: "opportunity_flag", key: "MERCHANT_PROCESSING_OPP" }];
    const r = validatePaid47V2(a, CONTEXT);
    assert.equal(r.ok, false);
    assert.ok(r.deficiencies.some((d) => d.code === "GAP_OPP_FLAG_ONLY"));
  });

  it("accepts an opportunity flag alongside a real anchor", () => {
    const a = baseAgent();
    a.opportunityFlags = ["MERCHANT_PROCESSING_OPP"];
    a.gaps[0].evidence = [
      { type: "derived_metric", key: "ar_60_plus_months_of_debt_service" },
      { type: "opportunity_flag", key: "MERCHANT_PROCESSING_OPP" },
    ];
    const r = validatePaid47V2(a, CONTEXT);
    assert.equal(r.ok, true, JSON.stringify(r.deficiencies));
  });

  it("rejects an evidence key not present in FACTS or DERIVED METRICS", () => {
    const a = baseAgent();
    a.gaps[0].evidence = [{ type: "derived_metric", key: "unicorn_ratio" }];
    const r = validatePaid47V2(a, CONTEXT);
    assert.equal(r.ok, false);
    assert.ok(r.deficiencies.some((d) => d.code === "GAP_EVIDENCE_UNFOUNDED"));
  });

  it("rejects a gap without an id", () => {
    const a = baseAgent();
    delete a.gaps[0].id;
    const r = validatePaid47V2(a, CONTEXT);
    assert.ok(r.deficiencies.some((d) => d.code === "GAP_MISSING_ID"));
  });

  it("rejects duplicate gap ids", () => {
    const a = baseAgent();
    a.gaps[1].id = a.gaps[0].id;
    const r = validatePaid47V2(a, CONTEXT);
    assert.ok(r.deficiencies.some((d) => d.code === "GAP_DUPLICATE_ID"));
  });

  it("rejects a gap missing required prose fields", () => {
    const a = baseAgent();
    a.gaps[0].known = "";
    a.gaps[0].whyItMatters = "";
    a.gaps[0].decisionImplication = "";
    a.gaps[0].unknown = "";
    const r = validatePaid47V2(a, CONTEXT);
    const codes = r.deficiencies.map((d) => d.code);
    assert.ok(codes.filter((c) => c === "GAP_MISSING_PROSE_FIELD").length >= 4);
  });

  it("accepts gap.unknown === 'none' as a legitimate value", () => {
    const a = baseAgent();
    a.gaps[0].unknown = "none";
    const r = validatePaid47V2(a, CONTEXT);
    assert.equal(r.ok, true);
  });

  it("rejects a connections entry referencing an unknown finding id", () => {
    const a = baseAgent();
    a.connections[0].findingIds = ["ar-aging", "ghost-finding"];
    const r = validatePaid47V2(a, CONTEXT);
    assert.ok(r.deficiencies.some((d) => d.code === "CONNECTION_UNKNOWN_FINDING"));
  });

  it("rejects coverage.connectionStatus 'no_material_connection_supported' when connections[] is non-empty", () => {
    const a = baseAgent();
    a.coverage.connectionStatus = "no_material_connection_supported";
    a.coverage.noConnectionReason = "no overlap";
    // connections[] still has one entry — inconsistent
    const r = validatePaid47V2(a, CONTEXT);
    assert.ok(r.deficiencies.some((d) => d.code === "CONNECTION_STATUS_INCONSISTENT"));
  });

  it("accepts coverage 'no_material_connection_supported' with empty connections[] + reason", () => {
    const a = baseAgent();
    a.connections = [];
    a.coverage.connectionStatus = "no_material_connection_supported";
    a.coverage.noConnectionReason = "The three gaps are independent diagnostics with no supported interaction.";
    const r = validatePaid47V2(a, CONTEXT);
    assert.equal(r.ok, true, JSON.stringify(r.deficiencies));
  });

  it("rejects coverage counts that don't match actual lengths", () => {
    const a = baseAgent();
    a.coverage.gapsReturned = 99;
    const r = validatePaid47V2(a, CONTEXT);
    assert.ok(r.deficiencies.some((d) => d.code === "COVERAGE_COUNT_MISMATCH"));
  });

  it("rejects a financialSnapshot row without a sourceType", () => {
    const a = baseAgent();
    delete a.financialSnapshot[0].sourceType;
    const r = validatePaid47V2(a, CONTEXT);
    assert.ok(r.deficiencies.some((d) => d.code === "SNAPSHOT_SOURCE_MISSING"));
  });

  it("rejects an opportunity with no evidence[]", () => {
    const a = baseAgent();
    a.opportunities[0].evidence = [];
    const r = validatePaid47V2(a, CONTEXT);
    assert.ok(r.deficiencies.some((d) => d.code === "OPP_MISSING_EVIDENCE"));
  });

  it("is permissive on evidence key when FACTS/metrics context is empty (catalog-unavailable fallback)", () => {
    const a = baseAgent();
    a.gaps[0].evidence = [{ type: "answer", key: "any_key_will_do" }];
    a.gaps[0].relatedFindingIds = [];
    const r = validatePaid47V2(a, { validFactKeys: new Set(), validMetricNames: new Set() });
    // key check is permissive here, but the gap still must be well-formed
    assert.equal(r.ok, true, JSON.stringify(r.deficiencies));
  });
});

describe("buildRegenerationNudge", () => {
  it("lists every deficiency with its code and message", () => {
    const nudge = buildRegenerationNudge([
      { code: "GAP_OPP_FLAG_ONLY", message: "No flag-only primary gaps." },
      { code: "CONNECTION_UNKNOWN_FINDING", message: "Reference real ids." },
    ]);
    assert.match(nudge, /paid_47 v2 contract/);
    assert.match(nudge, /\[GAP_OPP_FLAG_ONLY\] No flag-only primary gaps\./);
    assert.match(nudge, /\[CONNECTION_UNKNOWN_FINDING\] Reference real ids\./);
    assert.match(nudge, /return only the corrected JSON/);
  });
});
