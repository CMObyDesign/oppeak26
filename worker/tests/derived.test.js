// Phase 2B: deterministic derived-metrics engine. Code — not the LLM —
// computes every ratio Solomon cites.
//
// Hard rules verified by this suite:
//
//   - Only emit a metric when ALL required inputs are usable numbers.
//     Not null. Not undefined. Not the string "unknown". If any input
//     is missing or ambiguous, the metric does not appear.
//
//   - Division-by-zero is treated as a missing input, not a surprise.
//     If the denominator is zero, the metric does not appear.
//
//   - Each emitted metric records the exact inputs it used. The
//     strategist must always be able to trace a number back to the
//     answers that produced it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveMetrics, findMetric } from "../src/derived.js";
import { flatNormalized } from "../src/normalize.js";

// Shorthand: find a metric by name in the output.
function get(metrics, name) {
  return findMetric(metrics, name);
}

// --- deriveMetrics — core discipline ------------------------------------

describe("deriveMetrics — empty / invalid input", () => {
  it("returns [] for null / undefined / non-object", () => {
    assert.deepEqual(deriveMetrics(null), []);
    assert.deepEqual(deriveMetrics(undefined), []);
    assert.deepEqual(deriveMetrics("not an object"), []);
    assert.deepEqual(deriveMetrics(42), []);
  });

  it("returns [] when no required inputs are present", () => {
    assert.deepEqual(deriveMetrics({}), []);
    assert.deepEqual(deriveMetrics({ unrelated_field: "foo" }), []);
  });
});

// --- Debt dollar passthroughs -------------------------------------------

describe("deriveMetrics — debt passthroughs", () => {
  it("emits total_debt when total_corporate_debt is a number", () => {
    const m = get(deriveMetrics({ total_corporate_debt: 60000 }), "total_debt");
    assert.equal(m.value, 60000);
    assert.equal(m.unit, "dollars");
    assert.deepEqual(m.inputs, [{ field: "total_corporate_debt", value: 60000 }]);
  });

  it("does NOT emit total_debt when the input is null", () => {
    assert.equal(get(deriveMetrics({ total_corporate_debt: null }), "total_debt"), null);
  });

  it("does NOT emit total_debt when the input is the 'unknown' sentinel", () => {
    assert.equal(get(deriveMetrics({ total_corporate_debt: "unknown" }), "total_debt"), null);
  });

  it("emits monthly_debt_service_amount when present", () => {
    const m = get(deriveMetrics({ monthly_debt_service: 1800 }), "monthly_debt_service_amount");
    assert.equal(m.value, 1800);
    assert.equal(m.unit, "dollars");
  });

  it("emits ar_30_plus_amount and ar_60_plus_amount independently", () => {
    const metrics = deriveMetrics({ ar_30_plus: 18000, ar_60_plus: 6500 });
    assert.equal(get(metrics, "ar_30_plus_amount").value, 18000);
    assert.equal(get(metrics, "ar_60_plus_amount").value, 6500);
  });
});

// --- A/R age ratios ------------------------------------------------------

describe("deriveMetrics — A/R age ratios", () => {
  it("computes ar_60_plus_months_of_debt_service to 2 decimals (Liz's run)", () => {
    const m = get(
      deriveMetrics({ ar_60_plus: 6500, monthly_debt_service: 1800 }),
      "ar_60_plus_months_of_debt_service"
    );
    // 6500 / 1800 = 3.6111... rounds to 3.61
    assert.equal(m.value, 3.61);
    assert.equal(m.unit, "months");
    assert.deepEqual(m.inputs, [
      { field: "ar_60_plus", value: 6500 },
      { field: "monthly_debt_service", value: 1800 },
    ]);
  });

  it("computes ar_30_plus_months_of_debt_service", () => {
    const m = get(
      deriveMetrics({ ar_30_plus: 18000, monthly_debt_service: 1800 }),
      "ar_30_plus_months_of_debt_service"
    );
    assert.equal(m.value, 10);
  });

  it("does NOT emit the ratio when the numerator is missing", () => {
    const metrics = deriveMetrics({ monthly_debt_service: 1800 });
    assert.equal(get(metrics, "ar_60_plus_months_of_debt_service"), null);
    assert.equal(get(metrics, "ar_30_plus_months_of_debt_service"), null);
  });

  it("does NOT emit the ratio when the denominator is missing", () => {
    const metrics = deriveMetrics({ ar_60_plus: 6500 });
    assert.equal(get(metrics, "ar_60_plus_months_of_debt_service"), null);
  });

  it("does NOT emit the ratio when the denominator is 'unknown'", () => {
    const metrics = deriveMetrics({ ar_60_plus: 6500, monthly_debt_service: "unknown" });
    assert.equal(get(metrics, "ar_60_plus_months_of_debt_service"), null,
      "An 'unknown' denominator must not be converted to zero or guessed");
  });

  it("does NOT emit the ratio when the denominator is zero (no divide-by-zero)", () => {
    const metrics = deriveMetrics({ ar_60_plus: 6500, monthly_debt_service: 0 });
    assert.equal(get(metrics, "ar_60_plus_months_of_debt_service"), null);
  });

  it("does NOT emit the ratio when the denominator is negative", () => {
    const metrics = deriveMetrics({ ar_60_plus: 6500, monthly_debt_service: -500 });
    assert.equal(get(metrics, "ar_60_plus_months_of_debt_service"), null);
  });

  it("DOES emit the ratio when the numerator is zero (0 months is a real finding)", () => {
    const m = get(
      deriveMetrics({ ar_60_plus: 0, monthly_debt_service: 1800 }),
      "ar_60_plus_months_of_debt_service"
    );
    assert.equal(m.value, 0);
    assert.equal(m.unit, "months");
  });
});

// --- Funnel conversion rates --------------------------------------------
// These do not fire today — the normalizer doesn't yet collect the per-
// stage counts. The engine is in place for the day they are added.

describe("deriveMetrics — funnel conversion rates (ready for future intake)", () => {
  it("computes lead_to_booking_rate = 12 / 150 = 0.08 (8%)", () => {
    const m = get(
      deriveMetrics({ leads_per_month: 150, bookings_per_month: 12 }),
      "lead_to_booking_rate"
    );
    assert.equal(m.value, 0.08);
    assert.equal(m.unit, "ratio");
  });

  it("computes booking_to_show_rate = 8 / 12 ≈ 0.6667", () => {
    const m = get(
      deriveMetrics({ bookings_per_month: 12, shows_per_month: 8 }),
      "booking_to_show_rate"
    );
    assert.equal(m.value, 0.6667);
  });

  it("computes show_to_offer_rate = 6 / 8 = 0.75", () => {
    const m = get(
      deriveMetrics({ shows_per_month: 8, offers_per_month: 6 }),
      "show_to_offer_rate"
    );
    assert.equal(m.value, 0.75);
  });

  it("computes offer_to_close_rate = 2 / 6 ≈ 0.3333", () => {
    const m = get(
      deriveMetrics({ offers_per_month: 6, closes_per_month: 2 }),
      "offer_to_close_rate"
    );
    assert.equal(m.value, 0.3333);
  });

  it("computes lead_to_sale_rate = 2 / 150 ≈ 0.0133", () => {
    const m = get(
      deriveMetrics({ leads_per_month: 150, closes_per_month: 2 }),
      "lead_to_sale_rate"
    );
    assert.equal(m.value, 0.0133);
  });

  it("does NOT emit stage rates when stage counts are missing (partial funnel)", () => {
    const metrics = deriveMetrics({ leads_per_month: 150, bookings_per_month: 12 });
    // Can compute lead_to_booking (12/150), but NOT booking_to_show (no shows_per_month)
    assert.ok(get(metrics, "lead_to_booking_rate"));
    assert.equal(get(metrics, "booking_to_show_rate"), null);
    assert.equal(get(metrics, "show_to_offer_rate"), null);
    assert.equal(get(metrics, "offer_to_close_rate"), null);
  });
});

// --- End-to-end against normalize ---------------------------------------

describe("deriveMetrics — integration with Phase 2A normalizer output", () => {
  it("Liz's good run produces the expected debt + A/R metrics", () => {
    // Mirrors today's testing-again-liz paid_47 submission exactly as
    // flatNormalized would present it.
    const flat = flatNormalized([
      { question_key: "monthly_debt_service", normalized_value: 1800 },
      { question_key: "total_corporate_debt", normalized_value: 60000 },
      { question_key: "ar_60_plus", normalized_value: 6500 },
      { question_key: "ar_30_plus", normalized_value: 18000 },
      { question_key: "tax_returns_status", normalized_value: "current" },
      { question_key: "has_formal_audit", normalized_value: false },
      { question_key: "has_documented_budget", normalized_value: false },
      { question_key: "debt_status", normalized_value: "stretched" },
    ]);
    const metrics = deriveMetrics(flat);

    assert.equal(get(metrics, "total_debt").value, 60000);
    assert.equal(get(metrics, "monthly_debt_service_amount").value, 1800);
    assert.equal(get(metrics, "ar_30_plus_amount").value, 18000);
    assert.equal(get(metrics, "ar_60_plus_amount").value, 6500);
    assert.equal(get(metrics, "ar_30_plus_months_of_debt_service").value, 10);
    assert.equal(get(metrics, "ar_60_plus_months_of_debt_service").value, 3.61);

    // No funnel data in Liz's intake — those metrics must not appear.
    assert.equal(get(metrics, "lead_to_booking_rate"), null);
    assert.equal(get(metrics, "offer_to_close_rate"), null);
  });

  it("free-tier Liz (no paid-tier fields) produces zero derived metrics", () => {
    // Free-tier intake only has qualitative answers that don't yield a
    // ratio — the whole point of Phase 2B is that nothing fires without
    // numeric inputs. This is the "no fabricated denominators" invariant.
    const flat = flatNormalized([
      { question_key: "business_type", normalized_value: "Home improvement" },
      { question_key: "industry", normalized_value: "Residential construction" },
      { question_key: "financial_decision_basis", normalized_value: "bank_balance_heavy" },
      {
        question_key: "active_debt_summary",
        normalized_value: { subtypes: ["equipment_loan", "line_of_credit"], judgments_or_liens: false },
      },
    ]);
    assert.deepEqual(deriveMetrics(flat), []);
  });
});

// --- findMetric ---------------------------------------------------------

describe("findMetric", () => {
  const metrics = [
    { metric: "total_debt", value: 60000, unit: "dollars", inputs: [] },
    { metric: "ar_60_plus_months_of_debt_service", value: 3.61, unit: "months", inputs: [] },
  ];

  it("returns the entry when the name matches", () => {
    assert.equal(findMetric(metrics, "total_debt").value, 60000);
    assert.equal(findMetric(metrics, "ar_60_plus_months_of_debt_service").value, 3.61);
  });

  it("returns null when nothing matches", () => {
    assert.equal(findMetric(metrics, "nonexistent_metric"), null);
  });

  it("handles bad input gracefully", () => {
    assert.equal(findMetric(null, "x"), null);
    assert.equal(findMetric(undefined, "x"), null);
    assert.equal(findMetric("not an array", "x"), null);
  });
});
