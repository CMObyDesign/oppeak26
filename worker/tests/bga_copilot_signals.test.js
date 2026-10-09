// BGA Copilot — signal derivation tests (PR 6).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CANONICAL_SIGNALS,
  CANONICAL_DISQUALIFIERS,
  isCanonicalSignal,
  isCanonicalDisqualifier,
  tagsToSignals,
  verifiedFinancialsToSignals,
  intakeToSignals,
  deriveCaseSignals,
} from "../src/bga_copilot/signals.js";

describe("CANONICAL_SIGNALS / CANONICAL_DISQUALIFIERS — pinned vocabularies", () => {
  it("signals: exactly 11 and expected contents (append-only tracker)", () => {
    assert.equal(CANONICAL_SIGNALS.length, 11);
    for (const s of [
      "low_margin_visibility", "ar_concentration_risk", "ar_aging_90_plus_present",
      "no_13_week_cash_forecast", "monthly_close_absent_or_late", "debt_service_pressure",
      "bookkeeping_cleanup_needed", "hiring_plan_not_supportable",
      "pricing_review_opportunity", "tax_filings_current_but_strategy_absent",
      "growth_capital_question",
    ]) assert.ok(CANONICAL_SIGNALS.includes(s), `missing signal: ${s}`);
  });

  it("disqualifiers: exactly 6 and expected contents", () => {
    assert.equal(CANONICAL_DISQUALIFIERS.length, 6);
    for (const d of [
      "active_tax_default", "legal_distress", "revenue_band_below_500k",
      "revenue_band_above_10m", "books_not_closable", "owner_not_decision_maker",
    ]) assert.ok(CANONICAL_DISQUALIFIERS.includes(d), `missing dq: ${d}`);
  });

  it("signal and disqualifier sets are strictly disjoint", () => {
    for (const s of CANONICAL_SIGNALS) assert.ok(!CANONICAL_DISQUALIFIERS.includes(s));
    for (const d of CANONICAL_DISQUALIFIERS) assert.ok(!CANONICAL_SIGNALS.includes(d));
  });

  it("isCanonicalSignal / isCanonicalDisqualifier reject non-canonical", () => {
    assert.equal(isCanonicalSignal("low_margin_visibility"), true);
    assert.equal(isCanonicalSignal("made_up"), false);
    assert.equal(isCanonicalSignal(42), false);
    assert.equal(isCanonicalDisqualifier("active_tax_default"), true);
    assert.equal(isCanonicalDisqualifier("low_margin_visibility"), false);
  });
});

describe("tagsToSignals", () => {
  it("accepts bare slug tags", () => {
    const { signals, disqualifiers } = tagsToSignals([
      "swot_paid_297", "low_margin_visibility", "active_tax_default",
    ]);
    assert.deepEqual(signals, ["low_margin_visibility"]);
    assert.deepEqual(disqualifiers, ["active_tax_default"]);
  });

  it("accepts _opp suffix for signals and _dq suffix for disqualifiers", () => {
    const r = tagsToSignals([
      "ar_aging_90_plus_present_opp",
      "monthly_close_absent_or_late_opp",
      "books_not_closable_dq",
    ]);
    assert.ok(r.signals.includes("ar_aging_90_plus_present"));
    assert.ok(r.signals.includes("monthly_close_absent_or_late"));
    assert.ok(r.disqualifiers.includes("books_not_closable"));
  });

  it("silently ignores unknown slugs and non-canonical _opp bases", () => {
    const r = tagsToSignals(["random_tag", "made_up_signal_opp", "something_else"]);
    assert.deepEqual(r.signals, []);
    assert.deepEqual(r.disqualifiers, []);
  });

  it("case-insensitive on tags", () => {
    const r = tagsToSignals(["LOW_MARGIN_VISIBILITY_OPP"]);
    assert.deepEqual(r.signals, ["low_margin_visibility"]);
  });

  it("dedupes and sorts", () => {
    const r = tagsToSignals([
      "ar_concentration_risk",
      "ar_concentration_risk_opp",
      "low_margin_visibility",
    ]);
    assert.deepEqual(r.signals, ["ar_concentration_risk", "low_margin_visibility"]);
  });

  it("non-array input returns empty lists", () => {
    assert.deepEqual(tagsToSignals(null), { signals: [], disqualifiers: [] });
    assert.deepEqual(tagsToSignals("string"), { signals: [], disqualifiers: [] });
  });
});

describe("verifiedFinancialsToSignals", () => {
  it("revenue_ttm < 500_000 → revenue_band_below_500k", () => {
    const r = verifiedFinancialsToSignals([{ metric_id: "revenue_ttm", value: 450000 }]);
    assert.ok(r.disqualifiers.includes("revenue_band_below_500k"));
  });

  it("revenue_ttm > 10_000_000 → revenue_band_above_10m", () => {
    const r = verifiedFinancialsToSignals([{ metric_id: "revenue_ttm", value: 12_000_000 }]);
    assert.ok(r.disqualifiers.includes("revenue_band_above_10m"));
  });

  it("tax_status === 'in_default' → active_tax_default", () => {
    const r = verifiedFinancialsToSignals([{ metric_id: "tax_status", value: "in_default" }]);
    assert.ok(r.disqualifiers.includes("active_tax_default"));
  });

  it("ar_30_60_90 fires ar_aging_90_plus_present when BOTH $10k floor AND 1% of revenue clear", () => {
    // $96,800 on $1M revenue → 9.68% of revenue > 1%, >= $10k → fires
    const r = verifiedFinancialsToSignals([
      { metric_id: "revenue_ttm", value: 1_000_000 },
      { metric_id: "ar_30_60_90", value: { d30: 0, d60: 0, d90_plus: 96800 } },
    ]);
    assert.ok(r.signals.includes("ar_aging_90_plus_present"));
  });

  it("(Codex P2 on #97) ar_aging does NOT fire for immaterial d90_plus relative to revenue", () => {
    // $1 on multi-million-dollar business is noise.
    const r = verifiedFinancialsToSignals([
      { metric_id: "revenue_ttm", value: 5_000_000 },
      { metric_id: "ar_30_60_90", value: { d30: 0, d60: 0, d90_plus: 1 } },
    ]);
    assert.ok(!r.signals.includes("ar_aging_90_plus_present"));
  });

  it("(Codex P2 on #97) ar_aging requires BOTH floor AND share-of-revenue", () => {
    // Case 1: $15k but revenue is $5M → 0.3% of revenue — fails share.
    let r = verifiedFinancialsToSignals([
      { metric_id: "revenue_ttm", value: 5_000_000 },
      { metric_id: "ar_30_60_90", value: { d30: 0, d60: 0, d90_plus: 15_000 } },
    ]);
    assert.ok(!r.signals.includes("ar_aging_90_plus_present"));
    // Case 2: 2% of revenue but under $10k floor — fails floor.
    r = verifiedFinancialsToSignals([
      { metric_id: "revenue_ttm", value: 300_000 }, // triggers below_500k dq
      { metric_id: "ar_30_60_90", value: { d30: 0, d60: 0, d90_plus: 6000 } }, // 2% of rev, under $10k floor
    ]);
    assert.ok(!r.signals.includes("ar_aging_90_plus_present"));
  });

  it("ar_aging fires on $10k+ when revenue is unknown (conservative floor-only mode)", () => {
    const r = verifiedFinancialsToSignals([
      { metric_id: "ar_30_60_90", value: { d30: 0, d60: 0, d90_plus: 25_000 } },
    ]);
    assert.ok(r.signals.includes("ar_aging_90_plus_present"));
  });

  it("ar_30_60_90.d90_plus === 0 does NOT fire", () => {
    const r = verifiedFinancialsToSignals([
      { metric_id: "ar_30_60_90", value: { d30: 1000, d60: 500, d90_plus: 0 } },
    ]);
    assert.ok(!r.signals.includes("ar_aging_90_plus_present"));
  });

  it("debt_service_pressure fires only when annualized debt > 15% of revenue", () => {
    const over = verifiedFinancialsToSignals([
      { metric_id: "revenue_ttm", value: 1_000_000 },
      { metric_id: "monthly_debt_service", value: 20_000 }, // $240k annual, 24% of rev
    ]);
    assert.ok(over.signals.includes("debt_service_pressure"));

    const under = verifiedFinancialsToSignals([
      { metric_id: "revenue_ttm", value: 1_000_000 },
      { metric_id: "monthly_debt_service", value: 10_000 }, // $120k annual, 12% of rev
    ]);
    assert.ok(!under.signals.includes("debt_service_pressure"));
  });

  it("non-array input returns empty lists", () => {
    assert.deepEqual(verifiedFinancialsToSignals(null), { signals: [], disqualifiers: [] });
  });
});

describe("intakeToSignals — Codex P1 on #97", () => {
  it("fires no_13_week_cash_forecast on an answer that says there isn't one", () => {
    const r = intakeToSignals([
      { fieldKey: "p297_q", label: "Do you have a cash forecast?", value: "No, we don't have a 13-week cash forecast" },
    ]);
    assert.ok(r.signals.includes("no_13_week_cash_forecast"));
  });

  it("fires low_margin_visibility on 'don't know margin' style answers", () => {
    const r = intakeToSignals([
      { fieldKey: "p297_q", label: "What's your margin?", value: "Honestly we don't know gross margin per product line" },
    ]);
    assert.ok(r.signals.includes("low_margin_visibility"));
  });

  it("fires monthly_close_absent_or_late when the client says books close late", () => {
    const r = intakeToSignals([
      { fieldKey: "p297_q", label: "Monthly close?", value: "Our monthly close is always late — usually quarterly instead" },
    ]);
    assert.ok(r.signals.includes("monthly_close_absent_or_late"));
  });

  it("(Codex P2 on #99) does NOT fire monthly_close_absent_or_late on a healthy denial", () => {
    // "No issues; books close by day 7" used to fire because "no "
    // was in the condition list. Now it shouldn't.
    const r = intakeToSignals([
      { fieldKey: "p297_q", label: "Monthly close?", value: "No issues; books close by day 7" },
    ]);
    assert.ok(!r.signals.includes("monthly_close_absent_or_late"));
  });

  it("(Codex P2 on #99) fires monthly_close_absent_or_late on explicit absence phrasing", () => {
    const r = intakeToSignals([
      { fieldKey: "p297_q", label: "Monthly close?", value: "We don't close books monthly — quarterly only" },
    ]);
    assert.ok(r.signals.includes("monthly_close_absent_or_late"));
  });

  it("fires bookkeeping_cleanup_needed on 'books behind' / 'messy' phrasing", () => {
    const r = intakeToSignals([
      { fieldKey: "p297_q", label: "Books status?", value: "QuickBooks is a mess — months behind on reconciliation" },
    ]);
    assert.ok(r.signals.includes("bookkeeping_cleanup_needed"));
  });

  it("does NOT fire on topic alone without a condition keyword", () => {
    const r = intakeToSignals([
      { fieldKey: "p297_q", label: "Margin?", value: "Gross margin is strong this quarter" }, // topic yes, no condition
    ]);
    assert.ok(!r.signals.includes("low_margin_visibility"));
  });

  it("does NOT fire on condition alone without a topic keyword", () => {
    const r = intakeToSignals([
      { fieldKey: "p297_q", label: "x", value: "we don't have one" }, // condition yes, no topic
    ]);
    assert.deepEqual(r.signals, []);
  });

  it("non-array input returns empty signals list", () => {
    assert.deepEqual(intakeToSignals(null).signals, []);
    assert.deepEqual(intakeToSignals("string").signals, []);
  });
});

describe("deriveCaseSignals — combines tag + VF + intake derivation", () => {
  it("(Codex P1 on #97) unions intake-derived signals with tags + VF", () => {
    const r = deriveCaseSignals({
      tags: ["swot_paid_297", "low_margin_visibility"],
      verified_financials_entries: [{ metric_id: "revenue_ttm", value: 2_000_000 }],
      paid_297_answers: [
        { fieldKey: "q", label: "Cash forecast?", value: "no cash forecast exists" },
      ],
    });
    assert.ok(r.signals.includes("low_margin_visibility"));       // from tag
    assert.ok(r.signals.includes("no_13_week_cash_forecast"));    // from intake
  });

  it("merges tag signals with VF-derived disqualifiers, deduped and sorted", () => {
    const r = deriveCaseSignals({
      tags: ["swot_paid_297", "low_margin_visibility", "ar_aging_90_plus_present_opp"],
      verified_financials_entries: [
        { metric_id: "revenue_ttm", value: 450000 },
        { metric_id: "tax_status", value: "in_default" },
      ],
    });
    assert.deepEqual(r.signals.sort(), ["ar_aging_90_plus_present", "low_margin_visibility"].sort());
    assert.deepEqual(r.disqualifiers.sort(), ["active_tax_default", "revenue_band_below_500k"].sort());
  });

  it("empty inputs → empty outputs", () => {
    const r = deriveCaseSignals({ tags: [], verified_financials_entries: [] });
    assert.deepEqual(r.signals, []);
    assert.deepEqual(r.disqualifiers, []);
  });

  it("missing argument object is tolerated", () => {
    assert.doesNotThrow(() => deriveCaseSignals());
    const r = deriveCaseSignals();
    assert.deepEqual(r.signals, []);
    assert.deepEqual(r.disqualifiers, []);
  });
});
