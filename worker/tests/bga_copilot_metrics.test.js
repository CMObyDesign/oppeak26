// BGA Copilot — canonical metrics vocabulary tests.
//
// Pins:
//   - the exact set of canonical metric_ids (adding one is a schema change,
//     tracked here so a drift between code and spec surfaces loud)
//   - value-shape validation per metric (numbers, AR aging object, tax
//     enum, debt_terms text)
//   - entry-shape validation (metric_id + value + period + source_doc)
//   - upsert-by-metric-id semantics
//   - LARGE_TEXT parsing is lenient (empty / garbage → [], never throws)
//
// Spec references:
//   docs/BGA_COPILOT_SPEC.md §10 item 2 (canonical metric list)
//   docs/BGA_COPILOT_SPEC.md §4.2 (verified_financials_panel)

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CANONICAL_METRIC_IDS,
  isCanonicalMetric,
  validateMetricValue,
  validateVerifiedFinancialEntry,
  missingMetricIds,
  parseVerifiedFinancials,
  upsertEntry,
} from "../src/bga_copilot/metrics.js";

describe("CANONICAL_METRIC_IDS — the pinned vocabulary", () => {
  it("contains the exact set declared in spec §10 item 2 (plus debt_terms per Codex P2 on #92)", () => {
    const expected = [
      "cash_on_hand",
      "revenue_ttm",
      "gross_margin_pct",
      "net_profit_pct",
      "ar_30_60_90",
      "monthly_debt_service",
      "outstanding_debt_total",
      "debt_terms",
      "working_capital",
      "tax_status",
    ];
    assert.deepEqual([...CANONICAL_METRIC_IDS].sort(), [...expected].sort());
  });

  it("recognizes canonical ids and rejects unknown ones", () => {
    assert.equal(isCanonicalMetric("cash_on_hand"), true);
    assert.equal(isCanonicalMetric("debt_terms"), true);
    assert.equal(isCanonicalMetric("made_up_metric"), false);
    assert.equal(isCanonicalMetric(""), false);
    assert.equal(isCanonicalMetric(null), false);
    assert.equal(isCanonicalMetric(42), false);
  });
});

describe("validateMetricValue — per-shape value rules", () => {
  it("number shape requires a finite number", () => {
    assert.deepEqual(validateMetricValue("cash_on_hand", 184221), { ok: true });
    assert.deepEqual(validateMetricValue("gross_margin_pct", 38.4), { ok: true });

    assert.equal(validateMetricValue("cash_on_hand", "184221").ok, false);
    assert.equal(validateMetricValue("cash_on_hand", NaN).ok, false);
    assert.equal(validateMetricValue("cash_on_hand", Infinity).ok, false);
    assert.equal(validateMetricValue("cash_on_hand", null).ok, false);
  });

  it("ar_aging shape requires {d30, d60, d90_plus} all non-negative finite numbers", () => {
    assert.deepEqual(
      validateMetricValue("ar_30_60_90", { d30: 50000, d60: 80000, d90_plus: 96800 }),
      { ok: true },
    );
    // missing field
    assert.equal(
      validateMetricValue("ar_30_60_90", { d30: 50000, d60: 80000 }).ok,
      false,
    );
    // negative value
    assert.equal(
      validateMetricValue("ar_30_60_90", { d30: 50000, d60: -1, d90_plus: 96800 }).ok,
      false,
    );
    // array instead of object
    assert.equal(validateMetricValue("ar_30_60_90", [50000, 80000, 96800]).ok, false);
    // null
    assert.equal(validateMetricValue("ar_30_60_90", null).ok, false);
  });

  it("tax_enum shape only accepts current | behind | in_default", () => {
    assert.deepEqual(validateMetricValue("tax_status", "current"), { ok: true });
    assert.deepEqual(validateMetricValue("tax_status", "behind"), { ok: true });
    assert.deepEqual(validateMetricValue("tax_status", "in_default"), { ok: true });

    assert.equal(validateMetricValue("tax_status", "paid").ok, false);
    assert.equal(validateMetricValue("tax_status", "").ok, false);
    assert.equal(validateMetricValue("tax_status", null).ok, false);
  });

  it("text shape (debt_terms) requires a non-empty string", () => {
    assert.deepEqual(
      validateMetricValue("debt_terms", "SBA 7(a); 6.5% fixed; 10yr maturity; no prepay penalty"),
      { ok: true },
    );
    assert.equal(validateMetricValue("debt_terms", "").ok, false);
    assert.equal(validateMetricValue("debt_terms", "   ").ok, false);
    assert.equal(validateMetricValue("debt_terms", 650).ok, false);
    assert.equal(validateMetricValue("debt_terms", null).ok, false);
  });

  it("rejects unknown metric_id outright", () => {
    const r = validateMetricValue("not_a_real_metric", 42);
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown metric_id/);
  });
});

describe("validateVerifiedFinancialEntry — full entry shape", () => {
  const base = {
    metric_id: "cash_on_hand",
    value: 184221,
    period: "2026-09-30",
    source_doc: "balance_sheet_2026-09.pdf",
  };

  it("accepts a valid entry with all required fields", () => {
    assert.deepEqual(validateVerifiedFinancialEntry(base), { ok: true });
  });

  it("accepts an optional note", () => {
    assert.deepEqual(
      validateVerifiedFinancialEntry({ ...base, note: "reconciled by bookkeeper" }),
      { ok: true },
    );
  });

  it("rejects empty period or source_doc", () => {
    assert.equal(validateVerifiedFinancialEntry({ ...base, period: "" }).ok, false);
    assert.equal(validateVerifiedFinancialEntry({ ...base, period: "   " }).ok, false);
    assert.equal(validateVerifiedFinancialEntry({ ...base, source_doc: "" }).ok, false);
  });

  it("rejects a non-string note when note is present", () => {
    assert.equal(
      validateVerifiedFinancialEntry({ ...base, note: 42 }).ok,
      false,
    );
  });

  it("rejects a non-object entry", () => {
    assert.equal(validateVerifiedFinancialEntry(null).ok, false);
    assert.equal(validateVerifiedFinancialEntry("string").ok, false);
    assert.equal(validateVerifiedFinancialEntry([base]).ok, false);
  });

  it("rejects an entry with an unknown metric_id", () => {
    assert.equal(
      validateVerifiedFinancialEntry({ ...base, metric_id: "sales_pipeline" }).ok,
      false,
    );
  });
});

describe("missingMetricIds — gap detection", () => {
  it("returns all canonical ids when nothing is recorded", () => {
    assert.deepEqual([...missingMetricIds([])].sort(), [...CANONICAL_METRIC_IDS].sort());
  });

  it("subtracts recorded metric_ids from the canonical set", () => {
    const entries = [
      { metric_id: "cash_on_hand", value: 100 },
      { metric_id: "revenue_ttm", value: 1800000 },
    ];
    const missing = missingMetricIds(entries);
    assert.ok(!missing.includes("cash_on_hand"));
    assert.ok(!missing.includes("revenue_ttm"));
    assert.ok(missing.includes("gross_margin_pct"));
    assert.equal(missing.length, CANONICAL_METRIC_IDS.length - 2);
  });

  it("ignores entries with unknown or missing metric_id", () => {
    const entries = [
      { metric_id: "cash_on_hand", value: 100 },
      { metric_id: "not_canonical", value: 42 },
      { value: 50 },
      null,
    ];
    const missing = missingMetricIds(entries);
    assert.ok(!missing.includes("cash_on_hand"));
    // Only one id was validly consumed → missing is all - 1
    assert.equal(missing.length, CANONICAL_METRIC_IDS.length - 1);
  });

  it("handles non-array input gracefully (returns all canonical ids)", () => {
    assert.equal(missingMetricIds(null).length, CANONICAL_METRIC_IDS.length);
    assert.equal(missingMetricIds("not an array").length, CANONICAL_METRIC_IDS.length);
    assert.equal(missingMetricIds(undefined).length, CANONICAL_METRIC_IDS.length);
  });
});

describe("parseVerifiedFinancials — lenient parsing", () => {
  it("empty string returns []", () => {
    assert.deepEqual(parseVerifiedFinancials(""), []);
    assert.deepEqual(parseVerifiedFinancials("   "), []);
  });

  it("JSON array round-trip", () => {
    const original = [{ metric_id: "cash_on_hand", value: 100 }];
    const serialized = JSON.stringify(original);
    assert.deepEqual(parseVerifiedFinancials(serialized), original);
  });

  it("non-array JSON returns [] (treated as 'no entries')", () => {
    assert.deepEqual(parseVerifiedFinancials('{"not": "an array"}'), []);
    assert.deepEqual(parseVerifiedFinancials("42"), []);
    assert.deepEqual(parseVerifiedFinancials('"string"'), []);
  });

  it("garbage input returns [] without throwing", () => {
    assert.deepEqual(parseVerifiedFinancials("not json at all"), []);
    assert.deepEqual(parseVerifiedFinancials("}invalid{"), []);
  });

  it("non-string input returns []", () => {
    assert.deepEqual(parseVerifiedFinancials(null), []);
    assert.deepEqual(parseVerifiedFinancials(undefined), []);
    assert.deepEqual(parseVerifiedFinancials(42), []);
    assert.deepEqual(parseVerifiedFinancials([]), []);
  });
});

describe("upsertEntry — upsert by metric_id", () => {
  it("appends when metric_id is new", () => {
    const current = [{ metric_id: "cash_on_hand", value: 100 }];
    const next = upsertEntry(current, { metric_id: "revenue_ttm", value: 1800000 });
    assert.equal(next.length, 2);
    assert.equal(next[0].metric_id, "cash_on_hand");
    assert.equal(next[1].metric_id, "revenue_ttm");
  });

  it("replaces when metric_id already exists", () => {
    const current = [
      { metric_id: "cash_on_hand", value: 100 },
      { metric_id: "revenue_ttm", value: 1800000 },
    ];
    const next = upsertEntry(current, { metric_id: "cash_on_hand", value: 184221 });
    assert.equal(next.length, 2);
    const cash = next.find((e) => e.metric_id === "cash_on_hand");
    assert.equal(cash.value, 184221);
  });

  it("does not mutate the input array", () => {
    const current = [{ metric_id: "cash_on_hand", value: 100 }];
    const snapshot = JSON.stringify(current);
    upsertEntry(current, { metric_id: "cash_on_hand", value: 999 });
    assert.equal(JSON.stringify(current), snapshot);
  });

  it("appends into an empty array", () => {
    const next = upsertEntry([], { metric_id: "cash_on_hand", value: 100 });
    assert.deepEqual(next, [{ metric_id: "cash_on_hand", value: 100 }]);
  });
});
