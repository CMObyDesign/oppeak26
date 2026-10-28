// paid47-v2 response quality gate.
//
// The $47 Full Diagnostic emits a richer JSON shape than the free tier:
// gaps with evidence[]/known/unknown/decisionImplication, connections[]
// synthesizing across findings, questionsToClarify[], decisionOrder[],
// financialSnapshot[], and a coverage{} metadata block.
//
// This module validates one agent response against the v2 contract and
// returns either `{ ok: true }` or a list of deficiencies callers can
// hand back to the model to regenerate once. The gate is deliberately
// fail-soft: if a regeneration still fails, the caller downgrades the
// response to the v1 renderer (gaps[]+opportunities[]+next step) rather
// than taking the owner's $47 and showing a broken page.
//
// Validator rules (match TIER_GUIDE.paid_47 PAID_47 V2 EMISSION RULES):
//
//   1. reportSchemaVersion === "paid47-v2" AND tierGuideVersion ===
//      "paid47-2.0". Missing/other values → downgrade (not a hard fail).
//
//   2. Every gap and every opportunity has an `id` (non-empty string)
//      and at least one evidence[] entry.
//
//   3. A primary gap whose ONLY evidence[].type is "opportunity_flag"
//      is rejected. An opportunity flag can SUPPORT a gap, but it
//      cannot be the sole anchor. This is the Marisol discipline —
//      MERCHANT_PROCESSING_OPP is a hint toward an opportunity, not a
//      primary diagnostic.
//
//   4. Every evidence[].key must appear in FACTS, DERIVED METRICS, or
//      the response's own opportunityFlags[] (self-consistent flag set).
//
//   5. connections[].findingIds must each reference an id that appears
//      in gaps[] or opportunities[].
//
//   6. coverage{} internal consistency:
//      - gapsReturned === gaps.length
//      - opportunitiesReturned === opportunities.length
//      - connectionStatus === "no_material_connection_supported" ⇒
//        noConnectionReason non-empty AND connections[] is empty
//      - connectionStatus === "identified" ⇒ connections[] non-empty
//
//   7. financialSnapshot[] rows each cite a sourceType.
//
// Deficiencies are returned as `{ code, message }` pairs. Callers who
// regenerate should include the human-readable messages verbatim in
// the follow-up prompt so the model knows exactly what to fix.

const REQUIRED_SCHEMA_VERSION = "paid47-v2";
const REQUIRED_GUIDE_VERSION = "paid47-2.0";

const EVIDENCE_TYPES = new Set([
  "answer",
  "derived_metric",
  "opportunity_flag",
  "deterministic_fact",
]);

const ECONOMIC_MECHANISMS = new Set([
  "revenue capture",
  "margin protection",
  "cash timing",
  "recurring revenue",
  "reduced concentration",
  "cost control",
  "capital readiness",
  "capacity use",
  "financial decision-making",
]);

const SOURCE_TYPES = new Set([
  "customer_answer",
  "deterministic_fact",
  "derived_metric",
]);

const PRIORITIES = new Set(["CRITICAL", "HIGH", "MEDIUM"]);

/**
 * Decide whether an agent response claims the paid47-v2 contract.
 * Returns true only when BOTH version tags match verbatim. Any other
 * state is treated as v1 and will skip the v2 gate entirely.
 *
 * @param {object} agent
 */
export function claimsPaid47V2(agent) {
  if (!agent || typeof agent !== "object") return false;
  return (
    agent.reportSchemaVersion === REQUIRED_SCHEMA_VERSION &&
    agent.tierGuideVersion === REQUIRED_GUIDE_VERSION
  );
}

/**
 * Validate an agent response against the paid47-v2 contract.
 *
 * @param {object} agent — parsed agent JSON (post parseAgentJson)
 * @param {object} context
 * @param {Set<string>|string[]} context.validFactKeys — keys that appeared
 *   in the FACTS block the prompt sent to the model.
 * @param {Set<string>|string[]} context.validMetricNames — metric names
 *   that appeared in the DERIVED METRICS block.
 * @returns {{ ok: boolean, isV2: boolean, deficiencies: Array<{code:string,message:string}> }}
 */
export function validatePaid47V2(agent, context = {}) {
  const deficiencies = [];
  const push = (code, message) => deficiencies.push({ code, message });

  if (!claimsPaid47V2(agent)) {
    push(
      "MISSING_VERSION_TAGS",
      `Response must set reportSchemaVersion to "${REQUIRED_SCHEMA_VERSION}" and tierGuideVersion to "${REQUIRED_GUIDE_VERSION}" at the top level.`,
    );
    return { ok: false, isV2: false, deficiencies };
  }

  const factKeys = toSet(context.validFactKeys);
  const metricNames = toSet(context.validMetricNames);
  const flagSet = new Set(
    Array.isArray(agent.opportunityFlags)
      ? agent.opportunityFlags.map((f) => String(f))
      : [],
  );

  const gaps = Array.isArray(agent.gaps) ? agent.gaps : [];
  const opps = Array.isArray(agent.opportunities) ? agent.opportunities : [];
  const connections = Array.isArray(agent.connections) ? agent.connections : [];
  const coverage = (agent.coverage && typeof agent.coverage === "object") ? agent.coverage : {};

  // --- gaps[] -----------------------------------------------------------
  const gapIds = new Set();
  gaps.forEach((gap, i) => validateGap(gap, i, { factKeys, metricNames, flagSet, gapIds, push }));

  // --- opportunities[] --------------------------------------------------
  const oppIds = new Set();
  opps.forEach((o, i) => validateOpportunity(o, i, { factKeys, metricNames, flagSet, oppIds, push }));

  // --- connections[] ----------------------------------------------------
  const knownIds = new Set([...gapIds, ...oppIds]);
  connections.forEach((c, i) => {
    if (!c || typeof c !== "object") {
      push("CONNECTION_SHAPE", `connections[${i}] is not an object.`);
      return;
    }
    const ids = Array.isArray(c.findingIds) ? c.findingIds : [];
    if (ids.length < 2) {
      push("CONNECTION_TOO_FEW_IDS", `connections[${i}] must reference at least two finding ids.`);
    }
    for (const id of ids) {
      if (!knownIds.has(id)) {
        push(
          "CONNECTION_UNKNOWN_FINDING",
          `connections[${i}] references unknown finding id "${id}".`,
        );
      }
    }
    if (!c.explanation || !String(c.explanation).trim()) {
      push("CONNECTION_NO_EXPLANATION", `connections[${i}] has no explanation.`);
    }
  });

  // --- coverage{} -------------------------------------------------------
  if (Number.isFinite(coverage.gapsReturned) && coverage.gapsReturned !== gaps.length) {
    push(
      "COVERAGE_COUNT_MISMATCH",
      `coverage.gapsReturned (${coverage.gapsReturned}) does not match gaps.length (${gaps.length}).`,
    );
  }
  if (Number.isFinite(coverage.opportunitiesReturned) && coverage.opportunitiesReturned !== opps.length) {
    push(
      "COVERAGE_COUNT_MISMATCH",
      `coverage.opportunitiesReturned (${coverage.opportunitiesReturned}) does not match opportunities.length (${opps.length}).`,
    );
  }
  if (coverage.connectionStatus === "no_material_connection_supported") {
    if (connections.length > 0) {
      push(
        "CONNECTION_STATUS_INCONSISTENT",
        `coverage.connectionStatus is "no_material_connection_supported" but connections[] has ${connections.length} entries.`,
      );
    }
    if (!coverage.noConnectionReason || !String(coverage.noConnectionReason).trim()) {
      push(
        "CONNECTION_STATUS_INCONSISTENT",
        `coverage.connectionStatus is "no_material_connection_supported" but noConnectionReason is empty.`,
      );
    }
  } else if (coverage.connectionStatus === "identified" && connections.length === 0) {
    push(
      "CONNECTION_STATUS_INCONSISTENT",
      `coverage.connectionStatus is "identified" but connections[] is empty.`,
    );
  }

  // --- financialSnapshot[] ---------------------------------------------
  const snap = Array.isArray(agent.financialSnapshot) ? agent.financialSnapshot : [];
  snap.forEach((row, i) => {
    if (!row || typeof row !== "object") {
      push("SNAPSHOT_SHAPE", `financialSnapshot[${i}] is not an object.`);
      return;
    }
    if (!row.label || !String(row.label).trim()) {
      push("SNAPSHOT_NO_LABEL", `financialSnapshot[${i}] has no label.`);
    }
    if (!row.value || !String(row.value).trim()) {
      push("SNAPSHOT_NO_VALUE", `financialSnapshot[${i}] has no value.`);
    }
    if (!SOURCE_TYPES.has(row.sourceType)) {
      push(
        "SNAPSHOT_SOURCE_MISSING",
        `financialSnapshot[${i}] sourceType must be one of ${[...SOURCE_TYPES].join(", ")}.`,
      );
    }
  });

  return { ok: deficiencies.length === 0, isV2: true, deficiencies };
}

function validateGap(gap, i, ctx) {
  const { factKeys, metricNames, flagSet, gapIds, push } = ctx;
  if (!gap || typeof gap !== "object") {
    push("GAP_SHAPE", `gaps[${i}] is not an object.`);
    return;
  }
  const id = typeof gap.id === "string" ? gap.id.trim() : "";
  if (!id) {
    push("GAP_MISSING_ID", `gaps[${i}] is missing a stable kebab-case id.`);
  } else if (gapIds.has(id)) {
    push("GAP_DUPLICATE_ID", `gaps[${i}] id "${id}" is duplicated.`);
  } else {
    gapIds.add(id);
  }
  if (!PRIORITIES.has(gap.priority)) {
    push("GAP_BAD_PRIORITY", `gaps[${i}] priority must be one of ${[...PRIORITIES].join(", ")}.`);
  }
  for (const field of ["known", "whyItMatters", "decisionImplication"]) {
    if (!gap[field] || !String(gap[field]).trim()) {
      push("GAP_MISSING_PROSE_FIELD", `gaps[${i}] is missing required field "${field}".`);
    }
  }
  // "unknown" may legitimately be "none" when fully proven — accept the
  // string, require it be present and non-empty though.
  if (!gap.unknown || !String(gap.unknown).trim()) {
    push("GAP_MISSING_PROSE_FIELD", `gaps[${i}] is missing required field "unknown" (use "none" if fully proven).`);
  }

  const evidence = Array.isArray(gap.evidence) ? gap.evidence : [];
  if (evidence.length === 0) {
    push("GAP_MISSING_EVIDENCE", `gaps[${i}] has no evidence[] entries.`);
    return;
  }

  const types = new Set();
  evidence.forEach((ev, j) => {
    if (!ev || typeof ev !== "object") {
      push("GAP_EVIDENCE_SHAPE", `gaps[${i}].evidence[${j}] is not an object.`);
      return;
    }
    if (!EVIDENCE_TYPES.has(ev.type)) {
      push("GAP_EVIDENCE_BAD_TYPE", `gaps[${i}].evidence[${j}].type must be one of ${[...EVIDENCE_TYPES].join(", ")}.`);
    } else {
      types.add(ev.type);
    }
    const key = typeof ev.key === "string" ? ev.key.trim() : "";
    if (!key) {
      push("GAP_EVIDENCE_NO_KEY", `gaps[${i}].evidence[${j}] has no key.`);
      return;
    }
    if (!evidenceKeyAllowed(ev.type, key, factKeys, metricNames, flagSet)) {
      push(
        "GAP_EVIDENCE_UNFOUNDED",
        `gaps[${i}].evidence[${j}].key "${key}" is not in FACTS, DERIVED METRICS, or opportunityFlags for type "${ev.type}".`,
      );
    }
  });

  // The Marisol discipline: no primary gap grounded only in an
  // opportunity flag.
  if (evidence.length > 0 && types.size === 1 && types.has("opportunity_flag")) {
    push(
      "GAP_OPP_FLAG_ONLY",
      `gaps[${i}] "${gap.id || "(no id)"}" is grounded only in an opportunity flag; a primary gap requires at least one answer/derived_metric/deterministic_fact.`,
    );
  }
}

function validateOpportunity(opp, i, ctx) {
  const { factKeys, metricNames, flagSet, oppIds, push } = ctx;
  if (!opp || typeof opp !== "object") {
    push("OPP_SHAPE", `opportunities[${i}] is not an object.`);
    return;
  }
  const id = typeof opp.id === "string" ? opp.id.trim() : "";
  if (!id) {
    push("OPP_MISSING_ID", `opportunities[${i}] is missing a stable kebab-case id.`);
  } else if (oppIds.has(id)) {
    push("OPP_DUPLICATE_ID", `opportunities[${i}] id "${id}" is duplicated.`);
  } else {
    oppIds.add(id);
  }
  for (const field of ["whyCredible", "whatMustBeTrue", "nextValidation"]) {
    if (!opp[field] || !String(opp[field]).trim()) {
      push("OPP_MISSING_PROSE_FIELD", `opportunities[${i}] is missing required field "${field}".`);
    }
  }
  if (opp.economicMechanism !== undefined && !ECONOMIC_MECHANISMS.has(opp.economicMechanism)) {
    push(
      "OPP_BAD_MECHANISM",
      `opportunities[${i}].economicMechanism "${opp.economicMechanism}" must be one of ${[...ECONOMIC_MECHANISMS].join(" | ")}.`,
    );
  }

  const evidence = Array.isArray(opp.evidence) ? opp.evidence : [];
  if (evidence.length === 0) {
    push("OPP_MISSING_EVIDENCE", `opportunities[${i}] has no evidence[] entries.`);
    return;
  }
  evidence.forEach((ev, j) => {
    if (!ev || typeof ev !== "object") {
      push("OPP_EVIDENCE_SHAPE", `opportunities[${i}].evidence[${j}] is not an object.`);
      return;
    }
    if (!EVIDENCE_TYPES.has(ev.type)) {
      push("OPP_EVIDENCE_BAD_TYPE", `opportunities[${i}].evidence[${j}].type must be one of ${[...EVIDENCE_TYPES].join(", ")}.`);
    }
    const key = typeof ev.key === "string" ? ev.key.trim() : "";
    if (!key) {
      push("OPP_EVIDENCE_NO_KEY", `opportunities[${i}].evidence[${j}] has no key.`);
      return;
    }
    if (!evidenceKeyAllowed(ev.type, key, factKeys, metricNames, flagSet)) {
      push(
        "OPP_EVIDENCE_UNFOUNDED",
        `opportunities[${i}].evidence[${j}].key "${key}" is not in FACTS, DERIVED METRICS, or opportunityFlags for type "${ev.type}".`,
      );
    }
  });
}

function evidenceKeyAllowed(type, key, factKeys, metricNames, flagSet) {
  if (type === "answer" || type === "deterministic_fact") {
    // factKeys may be empty when the catalog was unavailable; in that
    // case the gate cannot enforce key provenance here — be permissive
    // and let sanitizeStructuredFindings handle the structured side.
    return factKeys.size === 0 || factKeys.has(key);
  }
  if (type === "derived_metric") {
    return metricNames.size === 0 || metricNames.has(key);
  }
  if (type === "opportunity_flag") {
    return flagSet.has(key);
  }
  return false;
}

function toSet(x) {
  if (!x) return new Set();
  if (x instanceof Set) return x;
  if (Array.isArray(x)) return new Set(x);
  if (typeof x === "object") return new Set(Object.keys(x));
  return new Set();
}

/**
 * Build the follow-up prompt the caller hands to the model when
 * regenerating after a quality-gate failure. Keeps it short — the
 * original rubric is already cached in the system block.
 *
 * @param {Array<{code:string,message:string}>} deficiencies
 */
export function buildRegenerationNudge(deficiencies) {
  const lines = deficiencies.map((d, i) => `${i + 1}. [${d.code}] ${d.message}`).join("\n");
  return `Your previous response did not satisfy the paid_47 v2 contract. Fix these specific issues and re-emit the FULL JSON response in the same shape. Do not acknowledge this message in prose — return only the corrected JSON.

Deficiencies:
${lines}`;
}
