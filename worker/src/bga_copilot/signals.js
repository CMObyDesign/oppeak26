// BGA Copilot — canonical signal + disqualifier vocabulary and
// case-level derivation (PR 6, docs/BGA_COPILOT_SPEC.md §4.4 + §7).
//
// Two closed vocabularies:
//   - CANONICAL_SIGNALS: a positive signal the case needs a service for.
//   - CANONICAL_DISQUALIFIERS: a current condition that excludes a
//     service even if its signals match.
//
// Both lists mirror the JSON Schema $defs in docs/services/CATALOG_SCHEMA.md
// (append-only; adding a signal requires a schema PR). We duplicate
// them here as a runtime check so a misspelling in the strategist's
// tags or the catalog surfaces as a "no match" at match-time rather
// than a silent miss.

export const CANONICAL_SIGNALS = Object.freeze([
  "low_margin_visibility",
  "ar_concentration_risk",
  "ar_aging_90_plus_present",
  "no_13_week_cash_forecast",
  "monthly_close_absent_or_late",
  "debt_service_pressure",
  "bookkeeping_cleanup_needed",
  "hiring_plan_not_supportable",
  "pricing_review_opportunity",
  "tax_filings_current_but_strategy_absent",
  "growth_capital_question",
]);

export const CANONICAL_DISQUALIFIERS = Object.freeze([
  "active_tax_default",
  "legal_distress",
  "revenue_band_below_500k",
  "revenue_band_above_10m",
  "books_not_closable",
  "owner_not_decision_maker",
]);

const SIGNAL_SET = new Set(CANONICAL_SIGNALS);
const DQ_SET = new Set(CANONICAL_DISQUALIFIERS);

export function isCanonicalSignal(s) { return typeof s === "string" && SIGNAL_SET.has(s); }
export function isCanonicalDisqualifier(s) { return typeof s === "string" && DQ_SET.has(s); }

/**
 * Strips HL's convention suffixes from a tag so a tag like
 * `low_margin_visibility_opp` or `low_margin_visibility` both map to
 * `low_margin_visibility`. Disqualifiers use `_dq`. Unknown suffixes
 * are returned as-is; the canonical-set check filters out junk.
 */
function stripSuffix(tag, suffix) {
  if (typeof tag !== "string") return "";
  const lower = tag.toLowerCase();
  return lower.endsWith(suffix) ? lower.slice(0, -suffix.length) : lower;
}

/**
 * Pulls active signals + disqualifiers from the case's HL tags.
 *
 * Convention:
 *   - A signal is active if the contact has a tag that is either the
 *     bare canonical signal slug or that slug plus `_opp`.
 *   - A disqualifier is active if the contact has a tag that is
 *     either the bare canonical disqualifier slug or that slug plus
 *     `_dq`.
 *   - Tags outside the canonical vocabulary are silently ignored.
 */
export function tagsToSignals(tags) {
  const activeSignals = new Set();
  const activeDisqualifiers = new Set();
  if (!Array.isArray(tags)) return { signals: [], disqualifiers: [] };
  for (const raw of tags) {
    const bareOpp = stripSuffix(raw, "_opp");
    if (SIGNAL_SET.has(bareOpp)) activeSignals.add(bareOpp);
    const bareDq = stripSuffix(raw, "_dq");
    if (DQ_SET.has(bareDq)) activeDisqualifiers.add(bareDq);
    // Also allow the bare slug with no suffix at all.
    const lower = typeof raw === "string" ? raw.toLowerCase() : "";
    if (SIGNAL_SET.has(lower)) activeSignals.add(lower);
    if (DQ_SET.has(lower)) activeDisqualifiers.add(lower);
  }
  return {
    signals: [...activeSignals].sort(),
    disqualifiers: [...activeDisqualifiers].sort(),
  };
}

/**
 * Pulls additional signals / disqualifiers from the case's verified
 * financials. Thresholds are deliberately conservative — fire only
 * when the number is unambiguous. The strategist can always override
 * via tags.
 *
 * Rules (per spec §7.4 "match_services iterates the catalog, scores
 * each service's signals_relevant against the current case's verified
 * facts + intake answers"):
 *
 *   - `revenue_ttm < 500_000`                → disqualifier `revenue_band_below_500k`
 *   - `revenue_ttm > 10_000_000`             → disqualifier `revenue_band_above_10m`
 *   - `tax_status === "in_default"`          → disqualifier `active_tax_default`
 *   - `ar_30_60_90.d90_plus > 0`             → signal `ar_aging_90_plus_present`
 *   - `monthly_debt_service > 0` with         → signal `debt_service_pressure`
 *      `revenue_ttm` present and
 *      annualized debt-service > 15% of revenue
 */
export function verifiedFinancialsToSignals(entries) {
  const signals = new Set();
  const disqualifiers = new Set();
  if (!Array.isArray(entries)) {
    return { signals: [], disqualifiers: [] };
  }

  const byId = {};
  for (const e of entries) {
    if (e && typeof e.metric_id === "string") byId[e.metric_id] = e;
  }

  const rev = byId.revenue_ttm?.value;
  if (typeof rev === "number" && Number.isFinite(rev)) {
    if (rev < 500_000) disqualifiers.add("revenue_band_below_500k");
    if (rev > 10_000_000) disqualifiers.add("revenue_band_above_10m");
  }

  const tax = byId.tax_status?.value;
  if (tax === "in_default") disqualifiers.add("active_tax_default");

  const ar = byId.ar_30_60_90?.value;
  if (ar && typeof ar === "object" && typeof ar.d90_plus === "number" && ar.d90_plus > 0) {
    signals.add("ar_aging_90_plus_present");
  }

  const monthlyDebt = byId.monthly_debt_service?.value;
  if (
    typeof monthlyDebt === "number" && monthlyDebt > 0 &&
    typeof rev === "number" && rev > 0 &&
    (monthlyDebt * 12) / rev > 0.15
  ) {
    signals.add("debt_service_pressure");
  }

  return {
    signals: [...signals].sort(),
    disqualifiers: [...disqualifiers].sort(),
  };
}

/**
 * Combines tag-derived + VF-derived signals/disqualifiers into one
 * deduped, sorted pair of lists. Used by match_services as the
 * authoritative input per spec §7.4.
 */
export function deriveCaseSignals({ tags, verified_financials_entries } = {}) {
  const fromTags = tagsToSignals(tags);
  const fromVf = verifiedFinancialsToSignals(verified_financials_entries);
  const signals = [...new Set([...fromTags.signals, ...fromVf.signals])].sort();
  const disqualifiers = [...new Set([...fromTags.disqualifiers, ...fromVf.disqualifiers])].sort();
  return { signals, disqualifiers };
}
