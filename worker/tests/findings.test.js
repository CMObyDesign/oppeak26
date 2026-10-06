// Phase 2C: structured findings validator + prompt-facts builder.
//
// A structured finding that cites evidence or a metric that doesn't
// exist is REJECTED before it reaches the stored diagnostic or the
// customer-facing renderer. The validator here enforces the schema
// against the Phase 2A normalized intake and the Phase 2B derived
// metrics; the pipeline in index.js logs the rejection reasons and
// strips the finding from `agent.structured_findings`.
//
// Hard rules verified:
//   1. Every evidence.field must exist in normalized (not null).
//   2. Primitive evidence.value must match the normalized value.
//   3. Every derived_metrics.metric must appear in derivedMetrics with
//      a matching value (±1% tolerance).
//   4. Finding has at least one evidence OR one derived_metric entry.
//   5. interpretation + recommendation non-empty.
//   6. severity ∈ {low, medium, high}; finding_id + category non-empty.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateStructuredFinding,
  validateStructuredFindings,
  buildFactsForPrompt,
} from "../src/findings.js";
import { sanitizeStructuredFindings } from "../src/index.js";

// A representative "Liz" context: the normalized + derived view today's
// paid_47 intake would produce.
const LIZ_CTX = {
  normalized: {
    monthly_debt_service: 1800,
    total_corporate_debt: 60000,
    ar_60_plus: 6500,
    ar_30_plus: 18000,
    tax_returns_status: "current",
    has_formal_audit: false,
    has_documented_budget: false,
    debt_status: "stretched",
  },
  derivedMetrics: [
    { metric: "total_debt", value: 60000, unit: "dollars", inputs: [] },
    { metric: "monthly_debt_service_amount", value: 1800, unit: "dollars", inputs: [] },
    { metric: "ar_60_plus_amount", value: 6500, unit: "dollars", inputs: [] },
    { metric: "ar_60_plus_months_of_debt_service", value: 3.61, unit: "months", inputs: [] },
  ],
};

const GOOD_FINDING = {
  finding_id: "ar-aging-001",
  category: "cash_flow",
  severity: "high",
  evidence: [
    { field: "ar_60_plus", value: 6500 },
    { field: "monthly_debt_service", value: 1800 },
  ],
  derived_metrics: [
    { metric: "ar_60_plus_months_of_debt_service", value: 3.61 },
  ],
  interpretation: "Meaningfully aged receivables may be adding avoidable cash-flow pressure.",
  recommendation: "Improve collection cadence before assuming additional expansion debt.",
};

// --- validateStructuredFinding — happy path -----------------------------

describe("validateStructuredFinding — happy path", () => {
  it("accepts a well-formed finding grounded in real evidence + a real metric", () => {
    const r = validateStructuredFinding(GOOD_FINDING, LIZ_CTX);
    assert.equal(r.ok, true, `expected OK, reasons=${JSON.stringify(r.reasons)}`);
    assert.deepEqual(r.reasons, []);
  });

  it("accepts evidence-only (no derived_metrics)", () => {
    const r = validateStructuredFinding(
      { ...GOOD_FINDING, derived_metrics: [] },
      LIZ_CTX
    );
    assert.equal(r.ok, true);
  });

  it("accepts derived-metrics-only (no evidence)", () => {
    const r = validateStructuredFinding(
      { ...GOOD_FINDING, evidence: [] },
      LIZ_CTX
    );
    assert.equal(r.ok, true);
  });

  it("allows ±1% floating-point tolerance on metric values", () => {
    // Compute engine stored 3.61; model might cite 3.6 (rounding down).
    const r = validateStructuredFinding(
      { ...GOOD_FINDING, derived_metrics: [{ metric: "ar_60_plus_months_of_debt_service", value: 3.6 }] },
      LIZ_CTX
    );
    assert.equal(r.ok, true, `expected OK with 3.6 vs 3.61, reasons=${JSON.stringify(r.reasons)}`);
  });

  it("accepts an evidence entry that cites a compound field without matching the object", () => {
    const ctx = {
      normalized: {
        active_debt_summary: { subtypes: ["equipment_loan"], judgments_or_liens: false },
      },
      derivedMetrics: [],
    };
    const r = validateStructuredFinding(
      {
        finding_id: "debt-posture-001",
        category: "debt",
        severity: "medium",
        evidence: [{ field: "active_debt_summary" }], // no value — allowed for compound
        derived_metrics: [],
        interpretation: "Only equipment-loan debt; posture is current.",
        recommendation: "Keep tracking monthly service against receivables.",
      },
      ctx
    );
    assert.equal(r.ok, true, `expected OK, reasons=${JSON.stringify(r.reasons)}`);
  });
});

// --- Codex P1: numeric evidence must be a finite number ---------------

describe("validateStructuredFinding — numeric evidence must be a number", () => {
  it("REJECTS a stringified numeric evidence value (e.g. '999999' vs 6500)", () => {
    // The output schema's placeholder shows value in quotes, which could
    // encourage the model to emit a stringified number. We require a real
    // finite number — "999999" is not an acceptable citation of 6500.
    const r = validateStructuredFinding(
      {
        ...GOOD_FINDING,
        evidence: [{ field: "ar_60_plus", value: "999999" }],
      },
      LIZ_CTX
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("ar_60_plus") && x.includes("finite number")));
  });

  it("REJECTS a missing evidence value for a numeric field", () => {
    const r = validateStructuredFinding(
      {
        ...GOOD_FINDING,
        evidence: [{ field: "ar_60_plus" }], // no value at all
      },
      LIZ_CTX
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("finite number")));
  });

  it("REJECTS a NaN or Infinity evidence value", () => {
    const r = validateStructuredFinding(
      { ...GOOD_FINDING, evidence: [{ field: "ar_60_plus", value: Number.NaN }] },
      LIZ_CTX
    );
    assert.equal(r.ok, false);
  });
});

// --- Codex P1: compound evidence must match stored properties ----------

describe("validateStructuredFinding — compound evidence", () => {
  const CTX_WITH_COMPOUND = {
    normalized: {
      active_debt_summary: { subtypes: ["equipment_loan"], judgments_or_liens: false },
    },
    derivedMetrics: [],
  };

  it("REJECTS a compound citation that invents judgments_or_liens:true", () => {
    // The exact PR #52 pattern recreated at the structured-finding
    // layer: stored says the owner denied judgments/liens; model claims
    // the opposite in the finding's evidence. Must be rejected.
    const r = validateStructuredFinding(
      {
        ...GOOD_FINDING,
        evidence: [{
          field: "active_debt_summary",
          value: { judgments_or_liens: true },
        }],
      },
      CTX_WITH_COMPOUND
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("judgments_or_liens")));
  });

  it("REJECTS a compound citation that invents an unreported subtype", () => {
    const r = validateStructuredFinding(
      {
        ...GOOD_FINDING,
        evidence: [{
          field: "active_debt_summary",
          value: { subtypes: ["tax_debt"] },
        }],
      },
      CTX_WITH_COMPOUND
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("tax_debt")));
  });

  it("accepts a compound citation whose subtypes are a subset of stored", () => {
    const r = validateStructuredFinding(
      {
        finding_id: "debt-001",
        category: "debt",
        severity: "medium",
        evidence: [{ field: "active_debt_summary", value: { subtypes: ["equipment_loan"] } }],
        derived_metrics: [],
        interpretation: "Equipment-loan debt, current.",
        recommendation: "Track monthly service against receivables.",
      },
      CTX_WITH_COMPOUND
    );
    assert.equal(r.ok, true, `expected OK, reasons=${JSON.stringify(r.reasons)}`);
  });

  it("accepts a compound field citation with no value echo (whole-object elision)", () => {
    const r = validateStructuredFinding(
      {
        finding_id: "debt-002",
        category: "debt",
        severity: "medium",
        evidence: [{ field: "active_debt_summary" }],
        derived_metrics: [],
        interpretation: "Owner reports debt detail — see summary.",
        recommendation: "Follow up.",
      },
      CTX_WITH_COMPOUND
    );
    assert.equal(r.ok, true);
  });

  it("REJECTS a compound citation that references a non-existent property", () => {
    const r = validateStructuredFinding(
      {
        ...GOOD_FINDING,
        evidence: [{
          field: "active_debt_summary",
          value: { in_default: true },
        }],
      },
      CTX_WITH_COMPOUND
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("in_default")));
  });
});

// --- Codex P1: derived-metric value must be a finite number ------------

describe("validateStructuredFinding — derived-metric numeric citations", () => {
  it("REJECTS a stringified derived_metrics.value (e.g. '999999' vs 60000)", () => {
    const r = validateStructuredFinding(
      {
        ...GOOD_FINDING,
        derived_metrics: [{ metric: "total_debt", value: "999999" }],
      },
      LIZ_CTX
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("total_debt") && x.includes("finite number")));
  });

  it("REJECTS a missing derived_metrics.value", () => {
    const r = validateStructuredFinding(
      {
        ...GOOD_FINDING,
        derived_metrics: [{ metric: "total_debt" }], // no value at all
      },
      LIZ_CTX
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("finite number")));
  });
});

// --- validateStructuredFinding — core discipline ------------------------

describe("validateStructuredFinding — invented facts", () => {
  it("REJECTS a finding citing a field that is not in normalized (invented tax_lien)", () => {
    // This is the exact PR #52 pattern enforced one layer deeper: if
    // Solomon decides to cite "tax_lien=true" without the owner having
    // reported it, the validator catches it before it reaches the
    // customer.
    const r = validateStructuredFinding(
      {
        ...GOOD_FINDING,
        evidence: [{ field: "tax_lien", value: true }],
      },
      LIZ_CTX
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("tax_lien")));
    assert.ok(r.reasons.some((x) => x.includes("not in the normalized intake")));
  });

  it("REJECTS a finding citing a numeric evidence value that doesn't match", () => {
    // Normalized says ar_60_plus = 6500; model claims 10000.
    const r = validateStructuredFinding(
      {
        ...GOOD_FINDING,
        evidence: [{ field: "ar_60_plus", value: 10000 }],
      },
      LIZ_CTX
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("10000") && x.includes("6500")));
  });

  it("REJECTS a finding citing a string evidence value that doesn't match", () => {
    const r = validateStructuredFinding(
      {
        ...GOOD_FINDING,
        evidence: [{ field: "debt_status", value: "delinquent" }],
      },
      LIZ_CTX
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("debt_status")));
  });

  it("REJECTS a finding citing a metric the engine did not compute (invented ratio)", () => {
    const r = validateStructuredFinding(
      {
        ...GOOD_FINDING,
        derived_metrics: [{ metric: "debt_to_revenue_ratio", value: 0.42 }],
      },
      LIZ_CTX
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("debt_to_revenue_ratio")));
    assert.ok(r.reasons.some((x) => x.includes("invent a ratio")));
  });

  it("REJECTS a finding citing a derived metric with a wrong value (>1% off)", () => {
    const r = validateStructuredFinding(
      {
        ...GOOD_FINDING,
        derived_metrics: [{ metric: "ar_60_plus_months_of_debt_service", value: 5.0 }],
      },
      LIZ_CTX
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("5") && x.includes("3.61")));
  });
});

describe("validateStructuredFinding — structural requirements", () => {
  it("REJECTS a finding with no evidence AND no derived_metrics (grounded in nothing)", () => {
    const r = validateStructuredFinding(
      {
        ...GOOD_FINDING,
        evidence: [],
        derived_metrics: [],
      },
      LIZ_CTX
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("grounded in nothing")));
  });

  it("REJECTS a finding with an invalid severity", () => {
    const r = validateStructuredFinding(
      { ...GOOD_FINDING, severity: "catastrophic" },
      LIZ_CTX
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("severity")));
  });

  it("REJECTS a finding with missing finding_id or category", () => {
    const r = validateStructuredFinding(
      { ...GOOD_FINDING, finding_id: "", category: "" },
      LIZ_CTX
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("finding_id")));
    assert.ok(r.reasons.some((x) => x.includes("category")));
  });

  it("REJECTS a finding with empty interpretation or recommendation", () => {
    const r = validateStructuredFinding(
      { ...GOOD_FINDING, interpretation: "", recommendation: "   " },
      LIZ_CTX
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("interpretation")));
    assert.ok(r.reasons.some((x) => x.includes("recommendation")));
  });

  it("REJECTS a non-object input gracefully", () => {
    assert.equal(validateStructuredFinding(null, LIZ_CTX).ok, false);
    assert.equal(validateStructuredFinding("string", LIZ_CTX).ok, false);
    assert.equal(validateStructuredFinding(42, LIZ_CTX).ok, false);
  });

  it("REJECTS a finding citing a field whose normalized value is null", () => {
    const ctx = {
      normalized: { has_formal_audit: null },
      derivedMetrics: [],
    };
    const r = validateStructuredFinding(
      {
        ...GOOD_FINDING,
        evidence: [{ field: "has_formal_audit", value: true }],
      },
      ctx
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("has no value")));
  });
});

// --- validateStructuredFindings bulk ------------------------------------

describe("validateStructuredFindings (bulk partition)", () => {
  it("splits valid and invalid findings into separate arrays", () => {
    const findings = [
      GOOD_FINDING,
      { ...GOOD_FINDING, evidence: [{ field: "invented_field", value: 1 }] },
      { ...GOOD_FINDING, finding_id: "second-good", derived_metrics: [{ metric: "total_debt", value: 60000 }] },
    ];
    const { valid, invalid } = validateStructuredFindings(findings, LIZ_CTX);
    assert.equal(valid.length, 2);
    assert.equal(invalid.length, 1);
    assert.ok(invalid[0].reasons.some((x) => x.includes("invented_field")));
  });

  it("returns {valid: [], invalid: []} for a non-array input", () => {
    const { valid, invalid } = validateStructuredFindings(null, LIZ_CTX);
    assert.deepEqual(valid, []);
    assert.deepEqual(invalid, []);
  });

  it("returns an invalid entry with the original finding and reasons", () => {
    const bad = { ...GOOD_FINDING, severity: "nope" };
    const { invalid } = validateStructuredFindings([bad], LIZ_CTX);
    assert.equal(invalid[0].finding, bad);
    assert.ok(invalid[0].reasons.length > 0);
  });
});

// --- buildFactsForPrompt ------------------------------------------------

describe("buildFactsForPrompt", () => {
  it("accepts the array shape produced by normalizeContactFields", () => {
    const b = buildFactsForPrompt(
      [
        { source_field_id: "x", question_key: "monthly_debt_service", normalized_value: 1800 },
        { source_field_id: "y", question_key: "ar_60_plus", normalized_value: 6500 },
      ],
      [{ metric: "total_debt", value: 60000 }]
    );
    assert.deepEqual(b.facts, { monthly_debt_service: 1800, ar_60_plus: 6500 });
    assert.equal(b.derived_metrics.length, 1);
  });

  it("accepts the flat object shape", () => {
    const b = buildFactsForPrompt(
      { monthly_debt_service: 1800, ar_60_plus: 6500 },
      [{ metric: "ar_60_plus_months_of_debt_service", value: 3.61 }]
    );
    assert.deepEqual(b.facts, { monthly_debt_service: 1800, ar_60_plus: 6500 });
  });

  it("drops null/undefined values but keeps 0 and false (both are meaningful)", () => {
    const b = buildFactsForPrompt(
      { ar_60_plus: 0, has_formal_audit: false, nothing: null, missing: undefined, keep: "x" },
      []
    );
    assert.deepEqual(b.facts, { ar_60_plus: 0, has_formal_audit: false, keep: "x" });
  });

  it("returns null when both facts and metrics are empty", () => {
    assert.equal(buildFactsForPrompt({}, []), null);
    assert.equal(buildFactsForPrompt([], []), null);
    assert.equal(buildFactsForPrompt(null, null), null);
  });

  it("still returns a bundle when metrics are present but facts are empty", () => {
    const b = buildFactsForPrompt({}, [{ metric: "total_debt", value: 60000 }]);
    assert.ok(b);
    assert.equal(b.derived_metrics.length, 1);
    assert.deepEqual(b.facts, {});
  });
});

// --- Codex P2: sanitizeStructuredFindings coverage ----------------------

describe("sanitizeStructuredFindings (shared helper used by every generation path)", () => {
  it("replaces a non-array structured_findings with [] and logs", () => {
    const agent = { structured_findings: { finding_id: "x" } }; // object, not array
    sanitizeStructuredFindings(agent, { normalized: {}, derivedMetrics: [] }, "test");
    assert.deepEqual(agent.structured_findings, [],
      "non-array structured_findings must be sanitized to []");
  });

  it("replaces a stringified structured_findings with []", () => {
    const agent = { structured_findings: "not an array" };
    sanitizeStructuredFindings(agent, { normalized: {}, derivedMetrics: [] }, "test");
    assert.deepEqual(agent.structured_findings, []);
  });

  it("leaves structured_findings undefined (no-op) when field is absent", () => {
    const agent = { headline: "x" };
    sanitizeStructuredFindings(agent, { normalized: {}, derivedMetrics: [] }, "test");
    assert.equal(agent.structured_findings, undefined,
      "absent field stays absent — don't add a key the model didn't emit");
  });

  it("strips every finding when context has no facts (console-run safety)", () => {
    // Console runs and public POSTs have no normalization context.
    // Every structured finding evaluated against an empty FACTS object
    // fails the grounded-in-nothing rule and is stripped — this is the
    // safe default the Codex P2 asked for.
    const agent = {
      structured_findings: [
        {
          finding_id: "x", category: "cash_flow", severity: "high",
          evidence: [{ field: "ar_60_plus", value: 6500 }],
          derived_metrics: [],
          interpretation: "x", recommendation: "y",
        },
      ],
    };
    sanitizeStructuredFindings(agent, { normalized: {}, derivedMetrics: [] }, "test");
    assert.deepEqual(agent.structured_findings, [],
      "finding citing ar_60_plus must be stripped when FACTS is empty");
  });

  it("keeps valid findings and strips invalid ones in the same pass", () => {
    const ctx = {
      normalized: { ar_60_plus: 6500, monthly_debt_service: 1800 },
      derivedMetrics: [{ metric: "ar_60_plus_months_of_debt_service", value: 3.61 }],
    };
    const agent = {
      structured_findings: [
        {
          finding_id: "good-001", category: "cash_flow", severity: "high",
          evidence: [{ field: "ar_60_plus", value: 6500 }],
          derived_metrics: [],
          interpretation: "x", recommendation: "y",
        },
        {
          finding_id: "bad-001", category: "cash_flow", severity: "high",
          evidence: [{ field: "invented_field", value: 1 }],
          derived_metrics: [],
          interpretation: "x", recommendation: "y",
        },
      ],
    };
    sanitizeStructuredFindings(agent, ctx, "test");
    assert.equal(agent.structured_findings.length, 1);
    assert.equal(agent.structured_findings[0].finding_id, "good-001");
  });

  it("is tolerant of a null/undefined agent (no throw)", () => {
    assert.doesNotThrow(() => sanitizeStructuredFindings(null, { normalized: {}, derivedMetrics: [] }, "test"));
    assert.doesNotThrow(() => sanitizeStructuredFindings(undefined, { normalized: {}, derivedMetrics: [] }, "test"));
  });
});
