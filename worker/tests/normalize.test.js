// Phase 2A: normalization layer. Deterministic, zero LLM. Rules:
//   - Preserve the raw answer. (That lives in raw_answers_json; nothing
//     here mutates it.)
//   - For known patterns, emit a typed normalized value (number, boolean,
//     enum string, or compound object).
//   - For missing input, emit null.
//   - For input present but unclassifiable, emit the literal "unknown".
//     Never fabricate a default.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PRIMITIVES,
  FIELD_NORMALIZERS,
  normalizeContactFields,
  flatNormalized,
} from "../src/normalize.js";

// --- primitives ----------------------------------------------------------

describe("normMoney", () => {
  const f = PRIMITIVES.normMoney;
  it("parses a bare integer", () => assert.equal(f("1800"), 1800));
  it("strips $ and commas", () => {
    assert.equal(f("$60,000"), 60000);
    assert.equal(f("$6,500.00"), 6500);
  });
  it("accepts decimals", () => assert.equal(f("1234.56"), 1234.56));
  it("returns null for empty / whitespace / null / undefined", () => {
    assert.equal(f(""), null);
    assert.equal(f("   "), null);
    assert.equal(f(null), null);
    assert.equal(f(undefined), null);
  });
  it("returns 'unknown' for non-numeric input (never fabricates)", () => {
    assert.equal(f("a few thousand"), "unknown");
    assert.equal(f("about $60k"), "unknown");
  });
});

describe("normCount", () => {
  const f = PRIMITIVES.normCount;
  it("parses integers", () => {
    assert.equal(f("150"), 150);
    assert.equal(f("12"), 12);
    assert.equal(f("1,200"), 1200);
  });
  it("rejects decimals as 'unknown' (counts are whole units)", () => {
    assert.equal(f("12.5"), "unknown");
  });
  it("returns null for empty, 'unknown' for garbage", () => {
    assert.equal(f(""), null);
    assert.equal(f("a dozen"), "unknown");
  });
});

describe("normYesNo", () => {
  const f = PRIMITIVES.normYesNo;
  it("recognizes affirmative", () => {
    assert.equal(f("yes"), true);
    assert.equal(f("Yes"), true);
    assert.equal(f("Y"), true);
    assert.equal(f("true"), true);
    assert.equal(f("1"), true);
  });
  it("recognizes negative", () => {
    assert.equal(f("No"), false);
    assert.equal(f("never"), false);
    assert.equal(f("false"), false);
    assert.equal(f("0"), false);
  });
  it("returns 'unknown' for ambiguous answers", () => {
    assert.equal(f("maybe"), "unknown");
    assert.equal(f("sort of"), "unknown");
  });
  it("returns null for empty", () => assert.equal(f(""), null));
});

describe("normTaxReturnsStatus", () => {
  const f = PRIMITIVES.normTaxReturnsStatus;
  it("maps 'Filed and current — no issues' to 'current'", () => {
    assert.equal(f("Filed and current — no issues"), "current");
  });
  it("maps 'Overdue' to 'overdue'", () => {
    assert.equal(f("Overdue"), "overdue");
    assert.equal(f("behind on returns"), "overdue");
  });
  it("maps 'Need to file' to 'not_filed'", () => {
    assert.equal(f("Need to file"), "not_filed");
    assert.equal(f("Not filed yet"), "not_filed");
  });
  it("maps payment plan language", () => {
    assert.equal(f("On a payment plan"), "on_payment_plan");
    assert.equal(f("installment agreement"), "on_payment_plan");
  });
  it("flags a tax lien", () => assert.equal(f("tax lien on the business"), "lien"));
  it("returns 'unknown' for unclassifiable answers", () => {
    assert.equal(f("complicated story"), "unknown");
  });
});

describe("normDebtStatus", () => {
  const f = PRIMITIVES.normDebtStatus;
  it("maps 'Current but stretched' to 'stretched'", () => {
    assert.equal(f("Current but stretched — it limits my flexibility"), "stretched");
  });
  it("maps 'Current' to 'current'", () => {
    assert.equal(f("Current"), "current");
    assert.equal(f("current, no issues"), "current");
  });
  it("maps delinquency language to 'delinquent'", () => {
    assert.equal(f("behind on payments"), "delinquent");
    assert.equal(f("missed last two months"), "delinquent");
  });
  it("maps 'paid off' to 'paid_off'", () => {
    assert.equal(f("Paid off"), "paid_off");
  });
});

describe("normMerchantReview", () => {
  const f = PRIMITIVES.normMerchantReview;
  it("maps the standard buckets", () => {
    assert.equal(f("Within the last 6 months"), "within_6_months");
    assert.equal(f("6 to 12 months ago"), "6_to_12_months");
    assert.equal(f("It's been 1-3 years"), "1_to_3_years");
    assert.equal(f("3 to 5 years ago"), "3_to_5_years");
    assert.equal(f("5+ years ago"), "5_plus_years");
    assert.equal(f("Never"), "never");
  });
});

describe("normFinancialDecisionBasis", () => {
  const f = PRIMITIVES.normFinancialDecisionBasis;
  it("flags bank-balance-only answers", () => {
    assert.equal(f("Mostly on what's in the bank account"), "bank_balance_heavy");
  });
  it("flags actual-numbers answers", () => {
    assert.equal(f("Based on actual numbers, our P&L"), "actual_numbers");
  });
  it("flags mixed when both mentioned", () => {
    assert.equal(f("Some actual numbers, some bank balance"), "mixed");
  });
  it("infers bank_balance_heavy from 'no formal budget'", () => {
    assert.equal(f("We don't have a formal budget"), "bank_balance_heavy");
  });
  it("returns 'unknown' when neither pattern matches", () => {
    assert.equal(f("gut feel"), "unknown");
  });
});

describe("normDebtSummary (compound)", () => {
  const f = PRIMITIVES.normDebtSummary;

  it("enumerates subtypes separately — never conflates", () => {
    const r = f("Equipment loan and a line of credit; all current");
    assert.deepEqual(r.subtypes.sort(), ["equipment_loan", "line_of_credit"]);
    assert.equal(r.judgments_or_liens, false);
  });

  it("sets judgments_or_liens: false when owner says 'no judgments or liens'", () => {
    const r = f("We have an equipment loan, no judgments or liens, taxes current");
    assert.equal(r.judgments_or_liens, false,
      "An explicit denial must not trip the flag — this was the invented-tax-lien bug PR #52 closed");
    assert.deepEqual(r.subtypes, ["equipment_loan"]);
  });

  it("sets judgments_or_liens: true only when affirmatively reported", () => {
    const r = f("Carrying a tax lien and an SBA loan");
    assert.equal(r.judgments_or_liens, true);
    assert.ok(r.subtypes.includes("tax_debt"));
    assert.ok(r.subtypes.includes("sba_loan"));
  });

  it("handles 'no debt' cleanly", () => {
    const r = f("No corporate debt, no judgments, no liens");
    assert.deepEqual(r.subtypes, []);
    assert.equal(r.judgments_or_liens, false);
  });

  it("picks up MCA / vendor / credit-card / vehicle variants", () => {
    const r = f("Credit card balances, a vehicle loan, and an MCA from last year");
    assert.ok(r.subtypes.includes("credit_card"));
    assert.ok(r.subtypes.includes("vehicle_loan"));
    assert.ok(r.subtypes.includes("merchant_cash_advance"));
  });
});

// --- FIELD_NORMALIZERS table integrity ----------------------------------

describe("FIELD_NORMALIZERS", () => {
  it("has an entry for every monetary paid_47 field we rely on in Phase 2B", () => {
    for (const needed of [
      "GGyFaucTwsIEsrXBHUsy", // monthly_debt_service
      "VSbsckWNIVSkTGu8CX9L", // total_corporate_debt
      "I5L5OKesluyAUffpjkGm", // ar_60_plus
      "wtgraIiCFH8h93om0Z3f", // ar_30_plus
    ]) {
      assert.ok(FIELD_NORMALIZERS[needed], `missing normalizer for field ${needed}`);
      assert.equal(FIELD_NORMALIZERS[needed].normalizer, PRIMITIVES.normMoney);
    }
  });

  it("assigns stable question_keys (used by derived-metrics in Phase 2B)", () => {
    assert.equal(FIELD_NORMALIZERS["GGyFaucTwsIEsrXBHUsy"].question_key, "monthly_debt_service");
    assert.equal(FIELD_NORMALIZERS["VSbsckWNIVSkTGu8CX9L"].question_key, "total_corporate_debt");
    assert.equal(FIELD_NORMALIZERS["I5L5OKesluyAUffpjkGm"].question_key, "ar_60_plus");
    assert.equal(FIELD_NORMALIZERS["wtgraIiCFH8h93om0Z3f"].question_key, "ar_30_plus");
    assert.equal(FIELD_NORMALIZERS["Bfv7HDFDma12jh2dMrEi"].question_key, "tax_returns_status");
    assert.equal(FIELD_NORMALIZERS["tbY1bimXCPjV7GocyPBv"].question_key, "debt_status");
    assert.equal(FIELD_NORMALIZERS["OyQjw4nGNHJYADsq5ggg"].question_key, "active_debt_summary");
    assert.equal(FIELD_NORMALIZERS["8sSKohKtQZZzJEtM2ju0"].question_key, "financial_decision_basis");
  });
});

// --- normalizeContactFields dispatcher ----------------------------------

describe("normalizeContactFields", () => {
  function makeContact(fields) {
    return { customFields: fields };
  }

  it("returns [] when the contact has no fields", () => {
    assert.deepEqual(normalizeContactFields({}, {}), []);
    assert.deepEqual(normalizeContactFields(null, {}), []);
  });

  it("emits one entry per NORMALIZED field (unmapped ids are skipped)", () => {
    const entries = normalizeContactFields(
      makeContact([
        { id: "GGyFaucTwsIEsrXBHUsy", value: "1800" },                           // monthly_debt_service
        { id: "I5L5OKesluyAUffpjkGm", value: "6500" },                           // ar_60_plus
        { id: "unknown-id-xyz", value: "junk that is not in the map" },          // skipped
      ]),
      {}
    );
    assert.equal(entries.length, 2, "unmapped field must not produce an entry");
    const byKey = Object.fromEntries(entries.map((e) => [e.question_key, e]));
    assert.equal(byKey.monthly_debt_service.normalized_value, 1800);
    assert.equal(byKey.ar_60_plus.normalized_value, 6500);
  });

  it("skips fields with empty raw values", () => {
    const entries = normalizeContactFields(
      makeContact([
        { id: "GGyFaucTwsIEsrXBHUsy", value: "" },      // empty — skip
        { id: "I5L5OKesluyAUffpjkGm", value: "   " },   // whitespace — skip
        { id: "VSbsckWNIVSkTGu8CX9L", value: "60000" }, // present — keep
      ]),
      {}
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0].question_key, "total_corporate_debt");
  });

  it("preserves raw_answer and raw_question alongside the normalized value", () => {
    const entries = normalizeContactFields(
      makeContact([
        { id: "GGyFaucTwsIEsrXBHUsy", value: "$1,800", name: "How much do you pay every month on servicing your corporate debt?" },
      ]),
      {}
    );
    assert.equal(entries.length, 1);
    const e = entries[0];
    assert.equal(e.source_field_id, "GGyFaucTwsIEsrXBHUsy");
    assert.equal(e.question_key, "monthly_debt_service");
    assert.equal(e.raw_question, "How much do you pay every month on servicing your corporate debt?");
    assert.equal(e.raw_answer, "$1,800");
    assert.equal(e.normalized_value, 1800);
  });

  it("falls back to catalog metadata for raw_question when the field lacks a name", () => {
    const entries = normalizeContactFields(
      makeContact([
        { id: "GGyFaucTwsIEsrXBHUsy", value: "1800" }, // no name/fieldKey here
      ]),
      {
        "GGyFaucTwsIEsrXBHUsy": { name: "Monthly debt service", fieldKey: "contact.monthly_debt_service" },
      }
    );
    assert.equal(entries[0].raw_question, "Monthly debt service");
  });

  it("whole-flow: Liz's intake snapshot normalizes to the expected shape", () => {
    // Mirrors today's testing-again-liz good run so a regression in any
    // normalizer surfaces as a semantic diff here, not just a unit miss.
    const entries = normalizeContactFields(
      makeContact([
        { id: "GGyFaucTwsIEsrXBHUsy", value: "1800" },
        { id: "VSbsckWNIVSkTGu8CX9L", value: "60000" },
        { id: "I5L5OKesluyAUffpjkGm", value: "6500" },
        { id: "wtgraIiCFH8h93om0Z3f", value: "18000" },
        { id: "Bfv7HDFDma12jh2dMrEi", value: "Filed and current — no issues" },
        { id: "cJXd2DNtzKXCbDjDNz1X", value: "No — never formally done" },
        { id: "kBmYfSbx77Cg72cCc1TG", value: "No — we operate without a formal budget" },
        { id: "tbY1bimXCPjV7GocyPBv", value: "Current but stretched — it limits my flexibility" },
        { id: "RwNhRxRitJX9NG8Lg4Q2", value: "It's been 1-3 years" },
      ]),
      {}
    );
    const flat = flatNormalized(entries);
    assert.equal(flat.monthly_debt_service, 1800);
    assert.equal(flat.total_corporate_debt, 60000);
    assert.equal(flat.ar_60_plus, 6500);
    assert.equal(flat.ar_30_plus, 18000);
    assert.equal(flat.tax_returns_status, "current");
    assert.equal(flat.has_formal_audit, false);
    assert.equal(flat.has_documented_budget, false);
    assert.equal(flat.debt_status, "stretched");
    assert.equal(flat.merchant_processing_last_review, "1_to_3_years");
  });
});

// --- flatNormalized ------------------------------------------------------

describe("flatNormalized", () => {
  it("flattens an entries array into a key→value map", () => {
    const flat = flatNormalized([
      { question_key: "ar_60_plus", normalized_value: 6500 },
      { question_key: "debt_status", normalized_value: "stretched" },
    ]);
    assert.deepEqual(flat, { ar_60_plus: 6500, debt_status: "stretched" });
  });
  it("returns {} for bad input", () => {
    assert.deepEqual(flatNormalized(null), {});
    assert.deepEqual(flatNormalized(undefined), {});
    assert.deepEqual(flatNormalized("not an array"), {});
  });
  it("ignores entries missing a question_key", () => {
    const flat = flatNormalized([
      { normalized_value: 42 },
      { question_key: "ok", normalized_value: 1 },
    ]);
    assert.deepEqual(flat, { ok: 1 });
  });
});
