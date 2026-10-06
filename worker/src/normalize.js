// Solomon canonical normalization (Phase 2A — see
// docs/SOLOMON_ARCHITECTURE.md and docs/CLOUDFLARE_DATA_MODEL.md).
//
// Deterministic conversion from GHL custom-field answers (raw text) into
// machine-friendly values Solomon's deriveds / rubric can consume. The raw
// answer is NEVER discarded — the submission row keeps the whole-answer
// snapshot in `raw_answers_json`. This module produces the parallel
// `normalized_answers_json` entries that Phase 2B's derived-metrics
// engine will read.
//
// Design rules:
//
//   1. Deterministic code only. Never a second LLM call. If an answer is
//      ambiguous, return the sentinel `"unknown"` — do not guess.
//
//   2. Each GHL field id maps to a stable `question_key` + a normalizer
//      function. If GHL renames a field in the UI, the id stays and the
//      question_key stays — the mapping is pinned to identity, not label.
//
//   3. Normalizer output is one of:
//        - number (money / count fields)
//        - boolean (yes/no fields)
//        - string enum (`"current"`, `"stretched"`, `"delinquent"`, …)
//        - object (compound fields — e.g. an active-debt summary with a
//          subtypes array and a judgments_or_liens boolean)
//        - null (empty input)
//        - the literal string `"unknown"` (input exists but cannot be
//          classified under the known set — never a fabricated default)
//
//   4. Compound textual answers (competitors, "bold move", methodology,
//      opportunity ideas) are NOT normalized here. They stay in
//      raw_answers_json; the rubric still reads them as prose. Only
//      answers with deterministic patterns get a normalized shape.
//
//   5. The dispatcher iterates the hydrated customFields array and emits
//      one entry per NORMALIZED field, carrying:
//        {
//          source_field_id,
//          question_key,
//          raw_question,
//          raw_answer,
//          normalized_value,
//        }
//      Fields with no entry in FIELD_NORMALIZERS are skipped. Their raw
//      text still exists in raw_answers_json.

// --- Per-field normalizer primitives --------------------------------------

function normText(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s || null;
}

// Strip $, commas, whitespace, then parse. Returns a finite number; `null`
// for empty; the sentinel `"unknown"` when input is non-empty but not a
// number (e.g. "a few thousand"). Never fabricates a default.
function normMoney(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/[\$,\s]/g, "").trim();
  if (!s) return null;
  // Allow negative numbers in principle (e.g. for an overdrawn account),
  // but reject non-numeric strings as "unknown".
  if (!/^-?\d+(\.\d+)?$/.test(s)) return "unknown";
  const n = Number(s);
  return Number.isFinite(n) ? n : "unknown";
}

// Integer counts (lead-counts, bookings, shows, offers, closes).
function normCount(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/[,\s]/g, "").trim();
  if (!s) return null;
  if (!/^-?\d+$/.test(s)) return "unknown";
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : "unknown";
}

function normYesNo(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (/^yes\b/.test(s) || s === "true" || s === "1" || /^y\b/.test(s)) return true;
  if (/^no\b|never\b/.test(s) || s === "false" || s === "0" || /^n\b/.test(s)) return false;
  return "unknown";
}

// "Filed and current" / "Overdue" / "Need to file" / "On a payment plan" / etc.
function normTaxReturnsStatus(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  // Order matters. Negative-filing patterns must come BEFORE the "filed"
  // match or "Not filed yet" would collide with `\bfiled\b`.
  if (/need to file|not filed|unfiled|haven't filed/.test(s)) return "not_filed";
  if (/payment plan|installment/.test(s)) return "on_payment_plan";
  if (/overdue|behind|late/.test(s)) return "overdue";
  if (/lien/.test(s)) return "lien";
  if (/\bfiled\b|\bcurrent\b|no issues/.test(s)) return "current";
  return "unknown";
}

// Debt status from the paid-tier "What is the status of your current
// corporate debt?" field. Known answer set: Current / Current but
// stretched / Behind on payments / etc.
function normDebtStatus(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (/stretch/.test(s)) return "stretched";
  if (/behind|late|miss|default|delinq/.test(s)) return "delinquent";
  if (/current\b|no issues/.test(s)) return "current";
  if (/paid off|zero/.test(s)) return "paid_off";
  return "unknown";
}

// Merchant-processing-last-reviewed answer buckets (used by the
// Phase 2B merchant-processing opportunity).
function normMerchantReview(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (/within.*6 months|under 6|less than 6/.test(s)) return "within_6_months";
  if (/6.*12 months|6 to 12|6-12/.test(s)) return "6_to_12_months";
  if (/1.*3 years|1 to 3|1-3 years/.test(s)) return "1_to_3_years";
  if (/3.*5 years|3 to 5|3-5 years/.test(s)) return "3_to_5_years";
  if (/5\+ years|more than 5|over 5/.test(s)) return "5_plus_years";
  if (/never\b/.test(s)) return "never";
  return "unknown";
}

// Financial decision basis — "Mostly on actual numbers" vs "Mostly on
// what's in the bank account" vs a mixed answer.
function normFinancialDecisionBasis(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  const mentionsBank = /bank (balance|account)/.test(s);
  const mentionsNumbers = /actual numbers?|financial statements?|p&l|p and l|real numbers?/.test(s);
  if (mentionsBank && !mentionsNumbers) return "bank_balance_heavy";
  if (mentionsNumbers && !mentionsBank) return "actual_numbers";
  if (mentionsBank && mentionsNumbers) return "mixed";
  // A business operating without a formal budget / audit / statements is
  // de facto bank-balance-heavy. Catches "we don't have", "no", "without".
  const noBudgetSignal = /(don'?t have|no|without)\s+(a\s+)?(formal\s+)?(budget|audit|p&l|financial statement|forecast)/i;
  if (noBudgetSignal.test(s)) return "bank_balance_heavy";
  return "unknown";
}

// Compound active-debt / tax-lien / judgments summary from the free-tier
// field. Produces { subtypes: string[], judgments_or_liens: boolean }.
// Debt subtypes are enumerated explicitly — never inferred from a blanket
// phrase like "active debt" (that was the invented-tax-lien bug PR #52
// closed). If the owner reports "no debt" / "no judgments or liens",
// subtypes is [] and judgments_or_liens is false.
function normDebtSummary(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const lower = s.toLowerCase();

  // Explicit denial of judgments/liens. Catches "no judgments or liens",
  // "no judgments, no liens", "no tax liens", etc. We check this first
  // so the subtype detector below doesn't falsely add "judgment" or
  // "tax_debt" from a sentence that is explicitly saying the owner does
  // NOT have those. This is the exact PR #52 debt-subtype discipline
  // played out at the normalizer layer.
  const noJudgments = /\bno (tax )?judgments?\b/.test(lower);
  const noLiens = /\bno (tax )?liens?\b/.test(lower);
  const noTaxDebt = /\bno (irs|tax) (debt|lien)s?\b/.test(lower);

  const subtypes = [];
  if (/equipment loan|equipment financing/.test(lower)) subtypes.push("equipment_loan");
  if (/line of credit|\bloc\b|revolv/.test(lower)) subtypes.push("line_of_credit");
  if (/\bsba\b|small business admin/.test(lower)) subtypes.push("sba_loan");
  if (/\bterm loan\b/.test(lower)) subtypes.push("term_loan");
  if (/vehicle (loan|financing)|truck loan|auto loan/.test(lower)) subtypes.push("vehicle_loan");
  if (/credit card/.test(lower)) subtypes.push("credit_card");
  if (/\bmca\b|merchant cash advance/.test(lower)) subtypes.push("merchant_cash_advance");
  if (/vendor debt|owe vendors?/.test(lower)) subtypes.push("vendor_debt");
  // Negation-aware subtype additions. Only add tax_debt if the owner
  // AFFIRMATIVELY reports tax liability — not when they explicitly deny it.
  if (/tax (lien|debt)|owe (the )?irs|irs debt/.test(lower) && !noTaxDebt && !noLiens) {
    subtypes.push("tax_debt");
  }
  if (/judgment|court order|legal action/.test(lower) && !noJudgments) {
    subtypes.push("judgment");
  }

  // judgments_or_liens: affirmative only. Both negation patterns above
  // keep this false even if the surface text contains the word.
  const judgments_or_liens =
    !noJudgments && !noLiens &&
    /judgment|tax lien\b|legal judgment/.test(lower);

  return {
    subtypes,
    judgments_or_liens,
  };
}

// --- Field-id → {question_key, normalizer} map ----------------------------
//
// The GHL field id is the stable identity. If the question wording
// changes in GHL, this table still matches. If GHL replaces a field with
// a new id, we add a new row — the old row stays reachable for historical
// submissions.

export const FIELD_NORMALIZERS = Object.freeze({
  // Free tier (P1-P3 + Q1-Q8) ----------------------------------------------
  "5VWVNRrQYcLqXhckh4f4": { question_key: "business_type",                 normalizer: normText },
  "nCRqWH0x1sdJIgUPDr2E": { question_key: "customer_acquisition_channel",  normalizer: normText },
  "nbPL6APmjrjr43J6urVb": { question_key: "industry",                      normalizer: normText },
  "OyQjw4nGNHJYADsq5ggg": { question_key: "active_debt_summary",           normalizer: normDebtSummary },
  "8sSKohKtQZZzJEtM2ju0": { question_key: "financial_decision_basis",      normalizer: normFinancialDecisionBasis },
  // Deliberately NOT normalizing: differentiator, referral language,
  // revenue leak, 20%-more-profit, demand not captured, 90-day loss.
  // Those are long-form narrative; they stay in raw_answers_json and
  // the rubric reads them as prose.

  // Paid 47 ----------------------------------------------------------------
  "GGyFaucTwsIEsrXBHUsy": { question_key: "monthly_debt_service",          normalizer: normMoney },
  "VSbsckWNIVSkTGu8CX9L": { question_key: "total_corporate_debt",          normalizer: normMoney },
  "I5L5OKesluyAUffpjkGm": { question_key: "ar_60_plus",                    normalizer: normMoney },
  "wtgraIiCFH8h93om0Z3f": { question_key: "ar_30_plus",                    normalizer: normMoney },
  "Bfv7HDFDma12jh2dMrEi": { question_key: "tax_returns_status",            normalizer: normTaxReturnsStatus },
  "cJXd2DNtzKXCbDjDNz1X": { question_key: "has_formal_audit",              normalizer: normYesNo },
  "kBmYfSbx77Cg72cCc1TG": { question_key: "has_documented_budget",         normalizer: normYesNo },
  "tbY1bimXCPjV7GocyPBv": { question_key: "debt_status",                   normalizer: normDebtStatus },
  "RwNhRxRitJX9NG8Lg4Q2": { question_key: "merchant_processing_last_review", normalizer: normMerchantReview },
  // Deliberately NOT normalizing paid_47 narrative fields: competitors,
  // automation ideas, best-margins, proprietary process, recurring revenue
  // idea, bold move, visibility, where losing deals, financial metrics not
  // tracked. Prose stays prose.
});

// Count helper exposed for test visibility — operational use is the full
// normalizeContactFields dispatcher below.
export const PRIMITIVES = Object.freeze({
  normText,
  normMoney,
  normCount,
  normYesNo,
  normTaxReturnsStatus,
  normDebtStatus,
  normMerchantReview,
  normFinancialDecisionBasis,
  normDebtSummary,
});

// --- Dispatcher -----------------------------------------------------------

/**
 * Normalize a GHL contact's customFields into the structured entries
 * Phase 2B's derived-metrics engine and Phase 2C's structured findings
 * will consume.
 *
 * Takes the contact's full customFields array plus a hydrated catalog
 * (keyed by GHL field id → {name, fieldKey, …}). Returns an array of:
 *   {
 *     source_field_id,
 *     question_key,
 *     raw_question,
 *     raw_answer,
 *     normalized_value,
 *   }
 *
 * Fields with no entry in FIELD_NORMALIZERS are SKIPPED (they still live
 * in raw_answers_json so nothing is lost). Fields with an empty raw value
 * are skipped too — a missing answer stays missing, not fabricated.
 *
 * @param {{ customFields?: Array<{id:string,value?:string,field_value?:string,name?:string,fieldKey?:string,key?:string}> } | null | undefined} contact
 * @param {Record<string, {name?:string,fieldKey?:string}> | undefined} catalog
 * @returns {Array<{source_field_id:string,question_key:string,raw_question:string|null,raw_answer:string,normalized_value:unknown}>}
 */
export function normalizeContactFields(contact, catalog) {
  const cfs = contact?.customFields || [];
  const out = [];
  for (const f of cfs) {
    if (!f || !f.id) continue;
    const spec = FIELD_NORMALIZERS[f.id];
    if (!spec) continue;
    const raw = f.value ?? f.field_value ?? "";
    const rawStr = typeof raw === "string" ? raw : String(raw ?? "");
    if (!rawStr.trim()) continue;
    const meta = catalog?.[f.id];
    const rawQuestion = f.name || meta?.name || f.fieldKey || meta?.fieldKey || null;
    out.push({
      source_field_id: f.id,
      question_key: spec.question_key,
      raw_question: rawQuestion,
      raw_answer: rawStr,
      normalized_value: spec.normalizer(rawStr),
    });
  }
  return out;
}

/**
 * Flat {question_key: normalized_value} view of a normalized-entries array.
 * This is the shape the Phase 2B derived-metrics engine will prefer; it
 * is derived, not stored. Last entry wins if a question_key appears twice
 * (which should never happen in practice — the schema has one row per
 * field id).
 *
 * @param {Array<{question_key:string,normalized_value:unknown}>} entries
 * @returns {Record<string, unknown>}
 */
export function flatNormalized(entries) {
  const out = {};
  if (!Array.isArray(entries)) return out;
  for (const e of entries) {
    if (!e || !e.question_key) continue;
    out[e.question_key] = e.normalized_value;
  }
  return out;
}
