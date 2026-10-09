// Canonical verified-financials metric vocabulary for the BGA Copilot.
//
// Single source of truth for metric_ids referenced by:
//   - verified_financials_panel (writes entries)
//   - audit_case_gaps          (reports which metrics are missing)
//   - match_services (dependency checks, PR 6)
//   - red_team_check (provenance validation, PR 12)
//
// Append-only. Adding a new metric requires:
//   1. Add the entry to CANONICAL_METRICS here.
//   2. Update docs/BGA_COPILOT_SPEC.md §10 item 2 to match.
//   3. Add a regression test for its value shape.
//   4. If match_services should recognize it as a dependency, update
//      the matcher in the same PR.
//
// Spec reference: docs/BGA_COPILOT_SPEC.md §10 item 2.

const SHAPE_NUMBER = "number";
const SHAPE_AR_AGING = "ar_aging";
const SHAPE_TAX_ENUM = "tax_enum";
const SHAPE_TEXT = "text";

const TAX_STATUS_VALUES = ["current", "behind", "in_default"];

export const CANONICAL_METRICS = Object.freeze({
  cash_on_hand:            { shape: SHAPE_NUMBER,    label: "Cash on hand",             unit: "usd" },
  revenue_ttm:             { shape: SHAPE_NUMBER,    label: "Revenue (trailing 12mo)",  unit: "usd" },
  gross_margin_pct:        { shape: SHAPE_NUMBER,    label: "Gross margin %",           unit: "percent" },
  net_profit_pct:          { shape: SHAPE_NUMBER,    label: "Net profit %",             unit: "percent" },
  ar_30_60_90:             { shape: SHAPE_AR_AGING,  label: "AR aging (30/60/90+)",     unit: "usd" },
  monthly_debt_service:    { shape: SHAPE_NUMBER,    label: "Monthly debt service",     unit: "usd" },
  outstanding_debt_total:  { shape: SHAPE_NUMBER,    label: "Total outstanding debt",   unit: "usd" },
  // debt_terms added per Codex P2 on #92: audit_case_gaps's debt-restructuring
  // example in spec §4.1 referenced a debt_terms fact that was missing from the
  // canonical list, so the audit could demand a fact the strategist had no way
  // to enter. Free-form text summary of interest rate(s), maturity, covenants,
  // prepayment penalties, personal guarantees — whatever the lender terms say.
  debt_terms:              { shape: SHAPE_TEXT,      label: "Debt terms (rate, maturity, covenants)", unit: "text" },
  working_capital:         { shape: SHAPE_NUMBER,    label: "Working capital",          unit: "usd" },
  tax_status:              { shape: SHAPE_TAX_ENUM,  label: "Tax status",               unit: "enum" },
});

export const CANONICAL_METRIC_IDS = Object.freeze(Object.keys(CANONICAL_METRICS));

/**
 * Returns true if the given metric_id is in the canonical list.
 */
export function isCanonicalMetric(metricId) {
  return typeof metricId === "string" && Object.prototype.hasOwnProperty.call(CANONICAL_METRICS, metricId);
}

/**
 * Validates a value against the shape required by its metric_id.
 * Returns { ok: true } or { ok: false, error: "<message>" }.
 *
 * Rules:
 *   - number shape: value is a finite number.
 *   - ar_aging shape: value is an object with numeric d30, d60, d90_plus (all >= 0).
 *   - tax_enum shape: value is one of "current" | "behind" | "in_default".
 */
export function validateMetricValue(metricId, value) {
  if (!isCanonicalMetric(metricId)) {
    return { ok: false, error: `unknown metric_id: ${JSON.stringify(metricId)}` };
  }
  const spec = CANONICAL_METRICS[metricId];
  if (spec.shape === SHAPE_NUMBER) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: `${metricId} expects a finite number value` };
    }
    return { ok: true };
  }
  if (spec.shape === SHAPE_AR_AGING) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: `${metricId} expects an object {d30, d60, d90_plus}` };
    }
    for (const k of ["d30", "d60", "d90_plus"]) {
      if (typeof value[k] !== "number" || !Number.isFinite(value[k]) || value[k] < 0) {
        return { ok: false, error: `${metricId}.${k} must be a non-negative finite number` };
      }
    }
    return { ok: true };
  }
  if (spec.shape === SHAPE_TAX_ENUM) {
    if (!TAX_STATUS_VALUES.includes(value)) {
      return { ok: false, error: `${metricId} must be one of: ${TAX_STATUS_VALUES.join(", ")}` };
    }
    return { ok: true };
  }
  if (spec.shape === SHAPE_TEXT) {
    if (typeof value !== "string" || value.trim() === "") {
      return { ok: false, error: `${metricId} expects a non-empty string value` };
    }
    return { ok: true };
  }
  // Should be unreachable — guarded by the shape constants above.
  return { ok: false, error: `metric ${metricId} has unknown shape ${spec.shape}` };
}

/**
 * Validates a verified-financial ENTRY (not just the value).
 * An entry is an object with at least metric_id, value, period, source_doc.
 * `note` is optional. `provenance` is forced to "verified" by the caller.
 */
export function validateVerifiedFinancialEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { ok: false, error: "entry must be an object" };
  }
  const valueCheck = validateMetricValue(entry.metric_id, entry.value);
  if (!valueCheck.ok) return valueCheck;
  if (typeof entry.period !== "string" || entry.period.trim() === "") {
    return { ok: false, error: "period must be a non-empty string" };
  }
  if (typeof entry.source_doc !== "string" || entry.source_doc.trim() === "") {
    return { ok: false, error: "source_doc must be a non-empty string" };
  }
  if (entry.note !== undefined && typeof entry.note !== "string") {
    return { ok: false, error: "note must be a string when present" };
  }
  return { ok: true };
}

/**
 * Returns the subset of CANONICAL_METRIC_IDS that are NOT represented in
 * the given array of verified-financial entries. The missing-list drives
 * the audit_case_gaps output.
 */
export function missingMetricIds(entries) {
  const have = new Set();
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (e && typeof e.metric_id === "string") have.add(e.metric_id);
    }
  }
  return CANONICAL_METRIC_IDS.filter((id) => !have.has(id));
}

/**
 * Parses the raw LARGE_TEXT content of swot_verified_financials into an
 * array. The HL field holds JSON (per spec §6). On any parse failure or
 * non-array result, returns an empty array — the field is treated as
 * "no verified financials recorded yet," not "corrupt data crash."
 */
export function parseVerifiedFinancials(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Upserts an entry into a verified-financials array by metric_id. If an
 * entry with the same metric_id already exists, it is replaced; otherwise
 * the new entry is appended. Returns a new array (does not mutate input).
 */
export function upsertEntry(entries, newEntry) {
  const idx = entries.findIndex((e) => e && e.metric_id === newEntry.metric_id);
  if (idx === -1) return [...entries, newEntry];
  const next = entries.slice();
  next[idx] = newEntry;
  return next;
}
