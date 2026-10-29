// Solomon canonical derived metrics (Phase 2B — see
// docs/SOLOMON_ARCHITECTURE.md and docs/CLOUDFLARE_DATA_MODEL.md).
//
// Code — not the LLM — computes every financial ratio Solomon uses. The
// output lands in `derived_metrics_json` on the report_versions row and
// serves two downstream consumers:
//
//   1. The Phase 2C rubric prompt. The LLM receives a `derived_metrics`
//      object as a FACT, not a request-to-compute. "3.61 months" is
//      written here once, deterministically; the model does not have to
//      divide 6500 by 1800 and we do not have to trust it to get it right.
//
//   2. Phase 2C structured findings. Each finding cites one or more
//      derived_metrics by name — and because every metric here records
//      its inputs with `source_question_key`, we can trace a sentence in
//      a shipped report back to the exact answers that produced it.
//
// Design rules (hard):
//
//   - Only emit a metric when ALL required inputs are usable numbers.
//     Not null. Not undefined. Not the string "unknown". If any input is
//     missing or ambiguous, the metric does not appear. No fabricated
//     zeros, no guessed denominators, no "estimated" fallbacks.
//
//   - Division-by-zero is treated as a missing input, not a surprise. If
//     the denominator is zero, the metric does not appear.
//
//   - Every emitted metric records the inputs it used. The caller — and
//     the strategist later — must always be able to answer "where did
//     this number come from?" by inspection of the row.
//
//   - Rounding is applied once, at output. Ratios round to 4 significant
//     places (0.0813 for 8.13%); month-counts round to 2 (3.61 months);
//     dollar passthroughs are not rounded.

/**
 * Phase 2B input shape — the flat view produced by
 * `flatNormalized(normalizedEntries)` in `./normalize.js`.
 * @typedef {Record<string, number | boolean | string | object | null | "unknown">} FlatNormalized
 */

/**
 * One entry in the derived_metrics array.
 * @typedef {{ metric: string, value: number, unit: "dollars" | "ratio" | "months", inputs: Array<{ field: string, value: number }> }} DerivedMetric
 */

// Round helpers — single source of truth so renderers see consistent
// precision across every metric.
function roundTo(n, decimals) {
  if (!Number.isFinite(n)) return n;
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/** @param {unknown} v */
function isNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Compute the full set of derived metrics for a submission. Takes the
 * flat normalized view and emits an array of {@link DerivedMetric}
 * entries. Fields missing from the normalized view OR carrying the
 * `"unknown"` sentinel are treated as not-present; the metric simply
 * does not appear in the output.
 *
 * @param {FlatNormalized | null | undefined} norm
 * @returns {DerivedMetric[]}
 */
export function deriveMetrics(norm) {
  if (!norm || typeof norm !== "object") return [];
  /** @type {DerivedMetric[]} */
  const out = [];

  // Simple passthrough of a known-numeric normalized field as a dollar
  // metric. Only emits when the input is a finite, nonnegative number —
  // "unknown", null, and negative values do nothing. Negative dollar
  // amounts are treated as GHL data-entry errors, not legitimate findings
  // ("-$5,000 of A/R 60+ days" is garbage output that would mislead a
  // customer). A zero passthrough DOES emit — $0 of A/R is a real
  // finding, distinct from missing data.
  function pushDollarPassthrough(metricName, questionKey) {
    const v = norm[questionKey];
    if (!isNumber(v)) return;
    if (v < 0) return;
    out.push({
      metric: metricName,
      value: v,
      unit: "dollars",
      inputs: [{ field: questionKey, value: v }],
    });
  }

  // Compute a ratio metric from two numeric normalized inputs.
  //   value = numerator / denominator
  // Only emits when both inputs are finite nonnegative numbers AND the
  // denominator is strictly positive. Division-by-zero is treated as a
  // missing input, not a surprise. A negative numerator (either a GHL
  // typo or a future count field that normalized to -1) is rejected —
  // "-2.78 months of debt service" or "-33% close rate" is garbage.
  // The numerator is still allowed to be zero: 0 months of A/R aging is
  // a real, meaningful finding; only negatives are rejected.
  function pushRatio({ metricName, numeratorKey, denominatorKey, unit, decimals }) {
    const num = norm[numeratorKey];
    const den = norm[denominatorKey];
    if (!isNumber(num) || !isNumber(den)) return;
    if (num < 0) return;
    if (den <= 0) return;
    const value = roundTo(num / den, decimals);
    if (!Number.isFinite(value)) return;
    out.push({
      metric: metricName,
      value,
      unit,
      inputs: [
        { field: numeratorKey, value: num },
        { field: denominatorKey, value: den },
      ],
    });
  }

  // --- Debt dollar passthroughs --------------------------------------------
  // The rubric and findings often cite "$60,000 of current corporate
  // debt" verbatim. Writing it here once ensures the number quoted in
  // the finding is the same number stored on the submission.
  pushDollarPassthrough("total_debt", "total_corporate_debt");
  pushDollarPassthrough("monthly_debt_service_amount", "monthly_debt_service");
  pushDollarPassthrough("ar_30_plus_amount", "ar_30_plus");
  pushDollarPassthrough("ar_60_plus_amount", "ar_60_plus");
  // Average Sale / Project Value (paid_47, 2026-10-29). Exposed to
  // the prompt as a passthrough so the model can anchor "how many
  // sales does X dollars represent" type comparisons on the real
  // owner-reported figure. No ratio or ROI math is computed from
  // this value here — see TIER_GUIDE.paid_47 "AVERAGE SALE /
  // PROJECT VALUE DISCIPLINE" for the rule set (never profit,
  // never margin, never cash, never LTV; a comparison like "a
  // $100,000 opportunity is roughly four $25,000 projects" is
  // allowed because that is deterministic division, not an ROI
  // claim).
  pushDollarPassthrough("average_sale_project_value_amount", "average_sale_project_value");

  // --- A/R aging vs debt service -------------------------------------------
  // "$6,500 in 60+ day receivables is 3.61 months of debt service" —
  // the kind of grounded, specific line Phase 2C findings cite.
  pushRatio({
    metricName: "ar_30_plus_months_of_debt_service",
    numeratorKey: "ar_30_plus",
    denominatorKey: "monthly_debt_service",
    unit: "months",
    decimals: 2,
  });
  pushRatio({
    metricName: "ar_60_plus_months_of_debt_service",
    numeratorKey: "ar_60_plus",
    denominatorKey: "monthly_debt_service",
    unit: "months",
    decimals: 2,
  });

  // --- Annualized debt service ---------------------------------------------
  // The paid_47 Financial Snapshot cites "$X per month, $X annualized" so
  // the owner can see the obligation at the scale decisions are made at.
  // monthly_debt_service × 12 is deterministic math; computing it here
  // keeps Solomon from improvising arithmetic (and getting it wrong in
  // ways that are hard to spot — a $20 error on $10,200 looks correct
  // enough to pass review).
  (() => {
    const monthly = norm.monthly_debt_service;
    if (!isNumber(monthly) || monthly < 0) return;
    out.push({
      metric: "annual_debt_service",
      value: roundTo(monthly * 12, 2),
      unit: "dollars",
      inputs: [{ field: "monthly_debt_service", value: monthly }],
    });
  })();

  // --- A/R aging concentration (60+ as share of 30+) -----------------------
  // "$9,000 of your $28,000 overdue A/R is already 60+ days" is a direct
  // concentration signal — collections are not keeping up with aging and
  // the problem is drifting older, not holding steady. Expressed as a
  // ratio (0.3214) so the renderer can decide whether to display as a
  // percentage (32.1%) or in-line. Only emits when BOTH ar_30_plus and
  // ar_60_plus are present AND ar_30_plus > 0 (division-by-zero on a
  // business with zero overdue A/R is not a legitimate finding).
  pushRatio({
    metricName: "ar_60_plus_share_of_30_plus",
    numeratorKey: "ar_60_plus",
    denominatorKey: "ar_30_plus",
    unit: "ratio",
    decimals: 4,
  });

  // --- Funnel conversion rates ---------------------------------------------
  // These do not fire today — the current GHL intake does not collect
  // the per-stage counts. The code is in place for the day the normalizer
  // adds `leads_per_month`, `bookings_per_month`, `shows_per_month`,
  // `offers_per_month`, `closes_per_month`. Each ratio stores a decimal
  // (0.08 means 8%); the renderer multiplies by 100 for display.
  pushRatio({
    metricName: "lead_to_booking_rate",
    numeratorKey: "bookings_per_month",
    denominatorKey: "leads_per_month",
    unit: "ratio",
    decimals: 4,
  });
  pushRatio({
    metricName: "booking_to_show_rate",
    numeratorKey: "shows_per_month",
    denominatorKey: "bookings_per_month",
    unit: "ratio",
    decimals: 4,
  });
  pushRatio({
    metricName: "show_to_offer_rate",
    numeratorKey: "offers_per_month",
    denominatorKey: "shows_per_month",
    unit: "ratio",
    decimals: 4,
  });
  pushRatio({
    metricName: "offer_to_close_rate",
    numeratorKey: "closes_per_month",
    denominatorKey: "offers_per_month",
    unit: "ratio",
    decimals: 4,
  });
  pushRatio({
    metricName: "lead_to_sale_rate",
    numeratorKey: "closes_per_month",
    denominatorKey: "leads_per_month",
    unit: "ratio",
    decimals: 4,
  });

  return out;
}

/**
 * Convenience lookup: find a specific metric by name in a derived_metrics
 * array. Returns the full entry (with inputs) or `null`.
 *
 * Phase 2C findings use this to retrieve the exact metric they want to
 * cite, instead of indexing by array position which would be brittle.
 *
 * @param {DerivedMetric[] | null | undefined} metrics
 * @param {string} name
 * @returns {DerivedMetric | null}
 */
export function findMetric(metrics, name) {
  if (!Array.isArray(metrics)) return null;
  for (const m of metrics) {
    if (m && m.metric === name) return m;
  }
  return null;
}
