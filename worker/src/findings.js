// Solomon structured findings (Phase 2C — see
// docs/SOLOMON_ARCHITECTURE.md and docs/CLOUDFLARE_DATA_MODEL.md).
//
// The diagnosis becomes data; the wording becomes presentation. Each
// structured finding is a machine-readable record that:
//
//   - names the specific intake fields it relies on (evidence),
//   - names the deterministic metrics it cites (derived_metrics),
//   - carries an interpretation and a recommendation,
//
// so the renderer (Phase 2D) can turn it into prose, the strategist
// (Phase 3) can correct it, and the validator here can REJECT findings
// that cite evidence or metrics that do not exist.
//
// Finding schema (TypeScript-ish):
//
//   {
//     finding_id: string,                            // kebab-case stable slug
//     category: string,                              // "cash_flow" | "debt" | "revenue" | ...
//     severity: "low" | "medium" | "high",
//     evidence: Array<{ field: string, value: unknown }>,
//     derived_metrics: Array<{ metric: string, value: number }>,
//     interpretation: string,                        // one line
//     recommendation: string,                        // one line
//   }
//
// Validation rules (hard — a finding that fails ANY rule is INVALID and
// is stripped before storage; the invalid version is still returned to
// the caller for logging):
//
//   1. Every `evidence[].field` must be a question_key present in the
//      Phase 2A normalized view with a non-null value. Solomon cannot
//      claim an intake fact that does not exist.
//
//   2. `evidence[].value`, when the normalized value is a primitive,
//      must equal the stored normalized value. Solomon cannot restate
//      a fact as a different number.
//
//   3. Every `derived_metrics[].metric` must appear in the Phase 2B
//      derivedMetrics array with the same value (±1% tolerance for
//      floating-point rounding). Solomon cannot invent a ratio.
//
//   4. Finding must have at least one evidence entry OR one derived
//      metric entry — a finding grounded in nothing is nothing.
//
//   5. interpretation and recommendation must be non-empty strings.
//
//   6. severity ∈ {low, medium, high}. finding_id and category are
//      non-empty strings.

/**
 * @typedef {Object} StructuredFindingEvidence
 * @property {string} field
 * @property {unknown} value
 */
/**
 * @typedef {Object} StructuredFindingMetric
 * @property {string} metric
 * @property {number} value
 */
/**
 * @typedef {Object} StructuredFinding
 * @property {string} finding_id
 * @property {string} category
 * @property {"low"|"medium"|"high"} severity
 * @property {StructuredFindingEvidence[]} evidence
 * @property {StructuredFindingMetric[]} derived_metrics
 * @property {string} interpretation
 * @property {string} recommendation
 */
/**
 * @typedef {Object} ValidationContext
 * @property {Record<string, unknown>} normalized  // flat question_key → value
 * @property {Array<{metric: string, value: number}>} derivedMetrics
 */
/**
 * @typedef {Object} ValidationResult
 * @property {boolean} ok
 * @property {string[]} reasons
 */

const VALID_SEVERITIES = new Set(["low", "medium", "high"]);
const METRIC_TOLERANCE = 0.01; // 1% — covers rounding at both ends

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function numericClose(a, b) {
  if (typeof a !== "number" || typeof b !== "number") return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === b) return true;
  if (a === 0) return Math.abs(b) < METRIC_TOLERANCE;
  return Math.abs((a - b) / a) <= METRIC_TOLERANCE;
}

/**
 * Validate a single structured finding against the normalized + derived
 * context. Returns `{ok, reasons[]}`. Reasons are human-readable so a
 * failing finding is easy to debug from the log line that reports it.
 *
 * @param {StructuredFinding} finding
 * @param {ValidationContext} ctx
 * @returns {ValidationResult}
 */
export function validateStructuredFinding(finding, ctx) {
  const reasons = [];

  if (!finding || typeof finding !== "object") {
    return { ok: false, reasons: ["finding is not an object"] };
  }
  if (!isNonEmptyString(finding.finding_id)) reasons.push("missing finding_id");
  if (!isNonEmptyString(finding.category))   reasons.push("missing category");
  if (!VALID_SEVERITIES.has(finding.severity)) {
    reasons.push(`severity must be low/medium/high (got ${JSON.stringify(finding.severity)})`);
  }
  if (!isNonEmptyString(finding.interpretation)) reasons.push("missing interpretation");
  if (!isNonEmptyString(finding.recommendation)) reasons.push("missing recommendation");

  const evidence = Array.isArray(finding.evidence) ? finding.evidence : [];
  const metrics  = Array.isArray(finding.derived_metrics) ? finding.derived_metrics : [];
  if (evidence.length === 0 && metrics.length === 0) {
    reasons.push("finding has no evidence and no derived_metrics (grounded in nothing)");
  }

  // Evidence: each field must exist in normalized; primitive values must
  // match the stored normalized value exactly.
  const normalized = ctx?.normalized || {};
  for (let i = 0; i < evidence.length; i++) {
    const e = evidence[i];
    if (!e || typeof e !== "object") {
      reasons.push(`evidence[${i}] is not an object`);
      continue;
    }
    if (!isNonEmptyString(e.field)) {
      reasons.push(`evidence[${i}] missing field name`);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(normalized, e.field)) {
      reasons.push(`evidence[${i}].field "${e.field}" is not in the normalized intake`);
      continue;
    }
    const stored = normalized[e.field];
    if (stored === null || stored === undefined) {
      reasons.push(`evidence[${i}].field "${e.field}" has no value in the normalized intake`);
      continue;
    }
    // Numeric fields require a numeric citation. If the stored value is
    // a number, the model MUST supply a finite number — stringified
    // amounts like "999999" (which the schema example's quoted
    // placeholder could encourage) are rejected before the tolerance
    // check runs. Omitting the value entirely is also rejected.
    if (typeof stored === "number") {
      if (typeof e.value !== "number" || !Number.isFinite(e.value)) {
        reasons.push(`evidence[${i}].value for numeric field "${e.field}" must be a finite number (got ${JSON.stringify(e.value)})`);
      } else if (!numericClose(stored, e.value)) {
        reasons.push(`evidence[${i}].value ${e.value} does not match normalized ${stored} for field "${e.field}"`);
      }
    } else if (typeof stored === "string" || typeof stored === "boolean") {
      if (e.value !== undefined && e.value !== stored) {
        reasons.push(`evidence[${i}].value ${JSON.stringify(e.value)} does not match normalized ${JSON.stringify(stored)} for field "${e.field}"`);
      }
    } else if (stored && typeof stored === "object") {
      // Compound value (e.g. active_debt_summary = {subtypes[], judgments_or_liens}).
      // When the model cites a compound value, EVERY property it names
      // must match the stored value's corresponding property. Without
      // this check a finding could claim judgments_or_liens:true on a
      // contact whose stored value is false — the exact PR #52 pattern.
      if (e.value && typeof e.value === "object" && !Array.isArray(e.value)) {
        for (const [k, v] of Object.entries(e.value)) {
          const storedProp = stored[k];
          if (storedProp === undefined) {
            reasons.push(`evidence[${i}].value.${k} refers to a property not present on normalized "${e.field}"`);
            continue;
          }
          if (Array.isArray(storedProp) && Array.isArray(v)) {
            // Shallow array comparison, order-insensitive — a subtypes
            // array citation must be a subset of the stored subtypes.
            for (const item of v) {
              if (!storedProp.includes(item)) {
                reasons.push(`evidence[${i}].value.${k} includes "${item}" which is not in normalized ${JSON.stringify(storedProp)} for field "${e.field}"`);
              }
            }
          } else if (storedProp !== v) {
            reasons.push(`evidence[${i}].value.${k} ${JSON.stringify(v)} does not match normalized ${JSON.stringify(storedProp)} for field "${e.field}"`);
          }
        }
      }
      // When e.value is undefined/null/scalar on a compound stored value,
      // the finding is just citing the field without echoing it —
      // allowed, matches the "whole object not required" doc.
    }
  }

  // Derived metrics: every reference must appear in the Phase 2B array
  // with a matching value.
  const derivedByName = new Map();
  for (const m of (ctx?.derivedMetrics || [])) {
    if (m && m.metric) derivedByName.set(m.metric, m);
  }
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    if (!m || typeof m !== "object") {
      reasons.push(`derived_metrics[${i}] is not an object`);
      continue;
    }
    if (!isNonEmptyString(m.metric)) {
      reasons.push(`derived_metrics[${i}] missing metric name`);
      continue;
    }
    const stored = derivedByName.get(m.metric);
    if (!stored) {
      reasons.push(`derived_metrics[${i}].metric "${m.metric}" was not computed deterministically — did you invent a ratio?`);
      continue;
    }
    // Model MUST supply a finite number. Omitted values and stringified
    // amounts ("999999") skip the tolerance check in the old code and
    // slip through as "validated" against the real engine value.
    if (typeof m.value !== "number" || !Number.isFinite(m.value)) {
      reasons.push(`derived_metrics[${i}].value for "${m.metric}" must be a finite number (got ${JSON.stringify(m.value)})`);
    } else if (!numericClose(stored.value, m.value)) {
      reasons.push(`derived_metrics[${i}].value ${m.value} does not match computed ${stored.value} for "${m.metric}"`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Validate every finding and partition the results. Invalid findings
 * carry the list of reasons they failed — the caller logs those and
 * strips them before storage.
 *
 * @param {StructuredFinding[]} findings
 * @param {ValidationContext} ctx
 * @returns {{ valid: StructuredFinding[], invalid: Array<{finding: StructuredFinding, reasons: string[]}> }}
 */
export function validateStructuredFindings(findings, ctx) {
  const valid = [];
  const invalid = [];
  if (!Array.isArray(findings)) return { valid, invalid };
  for (const f of findings) {
    const { ok, reasons } = validateStructuredFinding(f, ctx);
    if (ok) valid.push(f);
    else invalid.push({ finding: f, reasons });
  }
  return { valid, invalid };
}

/**
 * Build the clean prompt-input shape Phase 2C injects into the rubric
 * message. The rubric is instructed to cite ONLY fields present in
 * `facts` and metrics present in `derived_metrics` when emitting
 * structured_findings — the validator here enforces the rule after
 * generation.
 *
 * Returns `null` when the submission has no normalized/derived data
 * (free-tier or console runs that didn't normalize); the caller
 * should omit the FACTS section from the prompt entirely in that case.
 *
 * @param {Array<{question_key:string, normalized_value:unknown}> | Record<string, unknown> | null | undefined} normalized
 *   Either the flat view OR the array of normalized entries; both accepted.
 * @param {Array<{metric:string, value:number, unit?:string}> | null | undefined} derivedMetrics
 * @returns {{ facts: Record<string, unknown>, derived_metrics: Array<{metric:string,value:number,unit?:string}> } | null}
 */
export function buildFactsForPrompt(normalized, derivedMetrics) {
  const facts = {};
  if (Array.isArray(normalized)) {
    for (const e of normalized) {
      if (e && typeof e.question_key === "string" && e.normalized_value !== null && e.normalized_value !== undefined) {
        facts[e.question_key] = e.normalized_value;
      }
    }
  } else if (normalized && typeof normalized === "object") {
    for (const [k, v] of Object.entries(normalized)) {
      if (v !== null && v !== undefined) facts[k] = v;
    }
  }
  const metrics = Array.isArray(derivedMetrics) ? derivedMetrics.filter((m) => m && m.metric) : [];
  if (Object.keys(facts).length === 0 && metrics.length === 0) return null;
  return { facts, derived_metrics: metrics };
}
