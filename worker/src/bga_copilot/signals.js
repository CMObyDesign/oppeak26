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

  // (Codex P2 on #97) Materiality threshold: a $1 stale receivable on
  // a multi-million-dollar business shouldn't fire the signal. Require
  // the 90+ bucket to clear BOTH a floor ($10k, dollar-amount noise
  // filter) AND a share of revenue (1%, scale-aware filter) when
  // revenue_ttm is known. Falls back to the $10k floor alone when
  // revenue is unknown (avoids silently firing on an unknown-scale
  // business).
  const ar = byId.ar_30_60_90?.value;
  if (ar && typeof ar === "object" && typeof ar.d90_plus === "number" && ar.d90_plus > 0) {
    const AR_FLOOR_USD = 10_000;
    const AR_SHARE_OF_REV = 0.01;
    const revKnown = typeof rev === "number" && Number.isFinite(rev) && rev > 0;
    const material = revKnown
      ? ar.d90_plus >= AR_FLOOR_USD && ar.d90_plus >= rev * AR_SHARE_OF_REV
      : ar.d90_plus >= AR_FLOOR_USD;
    if (material) signals.add("ar_aging_90_plus_present");
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
 * Pulls signals from paid_297 intake answers via conservative keyword
 * heuristics. (Codex P1 on #97.) Intake answers often establish the
 * qualitative conditions the catalog signals name — "we don't have a
 * cash forecast", "margin visibility is weak", "monthly close is late
 * every quarter" — and the strategist can't be relied upon to tag
 * every such condition by hand.
 *
 * Rules deliberately conservative — a false positive here puts an
 * irrelevant service in Section 7, which the strategist has to
 * remove. We prefer missing a signal over inventing one. Each rule
 * requires BOTH a topic word AND a condition word in the same answer
 * text, so the slug fires only when the client wrote about the topic
 * in a condition-active way.
 *
 * Answers come in as `[{ fieldKey, label, value }]` — the extractor
 * output from case_load.js. We scan `label + " " + value` so a short
 * answer plus a descriptive label still match.
 */
export function intakeToSignals(answers) {
  const signals = new Set();
  if (!Array.isArray(answers)) return { signals: [] };

  const texts = answers
    .map((a) => (a && typeof a === "object")
      ? `${String(a.label || "")} ${String(a.value || "")}`.toLowerCase()
      : "")
    .filter((t) => t.length > 0);

  const anyMatches = (text, needles) => needles.some((n) => text.includes(n));

  const RULES = [
    {
      slug: "no_13_week_cash_forecast",
      topic: ["cash forecast", "13-week", "13 week", "cash flow forecast", "forward cash"],
      condition: ["no ", "don't have", "do not have", "none", "absent", "missing", "haven't", "have not"],
    },
    {
      slug: "low_margin_visibility",
      topic: ["margin", "gross margin", "profit margin"],
      condition: ["don't know", "do not know", "unclear", "no visibility", "surprise", "unknown", "can't tell"],
    },
    {
      slug: "monthly_close_absent_or_late",
      topic: ["monthly close", "month-end close", "month end close", "closing the books"],
      // (Codex P2 on #99) Bare "no "/"don't"/"do not" fired on
      // healthy answers like "No issues; books close by day 7".
      // Keep only absence/lateness-specific terms. The strategist can
      // still override via a `monthly_close_absent_or_late_opp` tag.
      condition: [
        "late", "behind", "absent", "skipped", "quarterly instead",
        "not closing", "not reconciled", "overdue", "months behind",
        "no monthly close", "no month-end close", "no month end close",
        "don't close", "do not close", "haven't closed", "have not closed",
      ],
    },
    {
      slug: "pricing_review_opportunity",
      topic: ["pricing", "prices", "price list", "rate card"],
      condition: ["haven't raised", "not raised", "stale", "not updated", "same price", "years ago", "last reviewed", "overdue"],
    },
    {
      slug: "ar_concentration_risk",
      topic: ["customer", "client", "revenue"],
      condition: ["concentrated", "single customer", "one customer", "top customer", "top client", "50% of revenue", "40% of revenue"],
    },
    {
      slug: "bookkeeping_cleanup_needed",
      topic: ["books", "bookkeeping", "quickbooks", "ledger", "chart of accounts"],
      condition: ["behind", "messy", "miscategor", "not reconciled", "unreconciled", "cleanup", "clean up", "catch up", "catch-up"],
    },
    {
      slug: "hiring_plan_not_supportable",
      topic: ["hire", "hiring", "add staff", "new role", "headcount"],
      condition: ["can't afford", "not sure", "stretched", "unsure", "worried about", "unsupportable"],
    },
    {
      slug: "tax_filings_current_but_strategy_absent",
      topic: ["tax", "taxes"],
      condition: ["no strategy", "no planning", "just file", "only file", "no tax plan", "nothing proactive"],
    },
    {
      slug: "growth_capital_question",
      topic: ["loan", "line of credit", "capital", "financing", "sba", "investor"],
      condition: ["consider", "should we", "weighing", "looking at", "exploring", "think about"],
    },
  ];

  for (const text of texts) {
    for (const r of RULES) {
      if (signals.has(r.slug)) continue;
      if (anyMatches(text, r.topic) && anyMatches(text, r.condition)) {
        signals.add(r.slug);
      }
    }
  }

  return { signals: [...signals].sort() };
}

/**
 * Combines tag-derived + VF-derived + intake-derived signals /
 * disqualifiers into one deduped, sorted pair of lists. Used by
 * match_services as the authoritative input per spec §7.4.
 *
 * (Codex P1 on #97) `paid_297_answers` is folded in so a paid-297
 * contact whose intake establishes a qualifying condition doesn't
 * need manual `_opp` tags to activate the matcher.
 */
export function deriveCaseSignals({
  tags,
  verified_financials_entries,
  paid_297_answers,
} = {}) {
  const fromTags = tagsToSignals(tags);
  const fromVf = verifiedFinancialsToSignals(verified_financials_entries);
  const fromIntake = intakeToSignals(paid_297_answers);
  const signals = [
    ...new Set([...fromTags.signals, ...fromVf.signals, ...fromIntake.signals]),
  ].sort();
  const disqualifiers = [
    ...new Set([...fromTags.disqualifiers, ...fromVf.disqualifiers]),
  ].sort();
  return { signals, disqualifiers };
}
