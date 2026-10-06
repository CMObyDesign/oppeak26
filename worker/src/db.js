// Solomon canonical store — D1 data access.
//
// See docs/CLOUDFLARE_DATA_MODEL.md for operational setup (wrangler d1
// create, migration apply, binding wiring) and docs/SOLOMON_ARCHITECTURE.md
// for the contracts this module enforces (immutable history, whole-answer
// snapshots, no reconstruction from live GHL fields).
//
// Design notes:
//
//   - Every public function takes an explicit D1 handle (`db`) rather than
//     an env — tests pass a mock; call sites use `dbFromEnv(env)`.
//
//   - When the binding is missing (freshly cloned repo, D1 not yet
//     provisioned), `dbFromEnv` returns null. Callers that get null MUST
//     fall back to the pre-D1 behavior and MUST NOT fail the request.
//     Phase 1a ships this module with no call sites; Phase 1b wires it in.
//
//   - JSON columns are stored as TEXT. Writers stringify, readers parse.
//     Parse failures throw — a corrupted JSON column is a data-integrity
//     bug worth surfacing, not swallowing.
//
//   - Reports and submissions are immutable. There is no `update*` export.
//     A regeneration inserts a new report_versions row with report_version
//     N+1. A corrected answer creates a new submission with its own id.
//
//   - All timestamps are unix milliseconds (`Date.now()`), stored as
//     INTEGER. Callers do not need to format them.

/**
 * @typedef {Object} D1PreparedStatement
 * @property {(...args: unknown[]) => D1PreparedStatement} bind
 * @property {() => Promise<{ success: boolean, meta?: unknown }>} run
 * @property {() => Promise<unknown>} first
 * @property {() => Promise<{ results: unknown[] }>} all
 */
/**
 * @typedef {Object} D1Database
 * @property {(sql: string) => D1PreparedStatement} prepare
 */

/**
 * Return the D1 handle from a Worker env, or null when the binding is
 * missing. Callers that get null MUST fall back to the pre-D1 behavior.
 * @param {Record<string, unknown> | undefined} env
 * @returns {D1Database | null}
 */
export function dbFromEnv(env) {
  const h = env?.SOLOMON_DB;
  return h && typeof h.prepare === "function" ? h : null;
}

/** New UUID for a submission row. */
export function newSubmissionId() {
  return crypto.randomUUID();
}

/** New UUID for a report_versions row. */
export function newReportId() {
  return crypto.randomUUID();
}

// --- Re-exports for callers that want to find a submission chain -------

/**
 * Insert a submission row. Submissions are immutable; this is the only
 * write path. Returns the inserted id (echo of input.id) or `null` when
 * the DB handle is missing.
 *
 * `source_event_id`, when supplied, enforces durable idempotency via the
 * unique index — a duplicate webhook retry returns `{ok: false, duplicate:
 * true}` instead of inserting a second row. Callers should treat that as
 * "someone else already recorded this submission; look it up by its id."
 *
 * @param {D1Database | null} db
 * @param {{
 *   id: string,
 *   contact_id: string,
 *   tier: string,
 *   assessment_version?: string,
 *   source_event_id?: string | null,
 *   raw_answers: unknown,
 *   normalized_answers?: unknown,
 *   derived_metrics?: unknown,
 *   validation?: unknown,
 *   status?: string,
 * }} s
 */
export async function insertSubmission(db, s) {
  if (!db) return { skipped: true, reason: "no_db_binding" };
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO submissions (
      id, contact_id, tier, assessment_version, source_event_id, created_at,
      raw_answers_json, normalized_answers_json, derived_metrics_json,
      validation_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    s.id,
    s.contact_id,
    s.tier,
    s.assessment_version || "v1",
    s.source_event_id || null,
    now,
    JSON.stringify(s.raw_answers ?? []),
    s.normalized_answers === undefined ? null : JSON.stringify(s.normalized_answers),
    s.derived_metrics === undefined ? null : JSON.stringify(s.derived_metrics),
    s.validation === undefined ? null : JSON.stringify(s.validation),
    s.status || "ready",
  );
  try {
    await stmt.run();
    return { ok: true, id: s.id };
  } catch (err) {
    // Unique index violation on (source_event_id, tier, assessment_version)
    // means another worker instance already recorded this submission.
    if (String(err?.message || "").match(/UNIQUE constraint failed/i)) {
      return { ok: false, duplicate: true, source_event_id: s.source_event_id };
    }
    throw err;
  }
}

/**
 * Compute the next report_version for a submission. Returns 1 for the
 * first generation; N+1 thereafter.
 * @param {D1Database | null} db
 * @param {string} submissionId
 */
export async function nextReportVersion(db, submissionId) {
  if (!db) return 1;
  const row = await db.prepare(
    `SELECT MAX(report_version) AS v FROM report_versions WHERE submission_id = ?`
  ).bind(submissionId).first();
  const current = row?.v ?? 0;
  return Number(current) + 1;
}

/**
 * Insert a report_versions row. Reports are immutable; a regeneration
 * creates a new row with the next report_version.
 *
 * @param {D1Database | null} db
 * @param {{
 *   id: string,
 *   submission_id: string,
 *   contact_id: string,
 *   tier: string,
 *   report_version: number,
 *   classification?: string | null,
 *   diagnostic: unknown,
 *   strategist_brief?: unknown,
 *   prompt_version?: string | null,
 *   rubric_version?: string | null,
 *   model_version?: string | null,
 *   code_version?: string | null,
 *   r2_html_key?: string | null,
 *   r2_html_bytes?: number | null,
 *   r2_html_sha256?: string | null,
 *   is_successful?: boolean,
 * }} r
 */
export async function insertReportVersion(db, r) {
  if (!db) return { skipped: true, reason: "no_db_binding" };
  const now = Date.now();
  await db.prepare(`
    INSERT INTO report_versions (
      id, submission_id, contact_id, tier, report_version, classification,
      diagnostic_json, strategist_brief_json, prompt_version, rubric_version,
      model_version, code_version, r2_html_key, r2_html_bytes, r2_html_sha256,
      created_at, is_successful
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    r.id,
    r.submission_id,
    r.contact_id,
    r.tier,
    r.report_version,
    r.classification || null,
    JSON.stringify(r.diagnostic ?? {}),
    r.strategist_brief === undefined ? null : JSON.stringify(r.strategist_brief),
    r.prompt_version || null,
    r.rubric_version || null,
    r.model_version || null,
    r.code_version || null,
    r.r2_html_key || null,
    r.r2_html_bytes ?? null,
    r.r2_html_sha256 || null,
    now,
    r.is_successful === false ? 0 : 1,
  ).run();
  return { ok: true, id: r.id };
}

/**
 * Return the latest successful report for a contact (the one HighLevel is
 * also holding). The read contract: with no version specified, /report
 * must resolve here.
 * @param {D1Database | null} db
 * @param {string} contactId
 */
export async function latestSuccessfulReport(db, contactId) {
  if (!db) return null;
  // Fail-open on D1 schema or outage errors: a missing report_versions
  // table (common during the migration-not-yet-applied window after a
  // new binding is wired) or a transient D1 outage must not block the
  // public /report/{contactId} read — the caller falls through to the
  // GHL projection, which is Phase 1c's documented safety net.
  try {
    const row = await db.prepare(`
      SELECT * FROM report_versions
      WHERE contact_id = ? AND is_successful = 1
      ORDER BY created_at DESC
      LIMIT 1
    `).bind(contactId).first();
    return hydrateReport(row);
  } catch (err) {
    console.warn(`[latestSuccessfulReport] D1 query failed for ${contactId}: ${err?.message || err}`);
    return null;
  }
}

/**
 * Return the submission_id of the contact's most recent intake. Phase 1c
 * follow-up uses this to disambiguate `?v=N`: writeCanonicalRecord mints
 * a fresh submission_id per generation and calls nextReportVersion with
 * that id, so free and paid chains for the same contact both start at
 * version 1. Without scoping `?v=N` to one chain, `?v=1` silently
 * returns whichever chain is newest. Scoping to the latest chain means
 * `?v=N` refers to the Nth report in the owner's current intake story;
 * historical chains stay reachable via `?report_id=<uuid>`.
 *
 * @param {D1Database | null} db
 * @param {string} contactId
 * @returns {Promise<string | null>}
 */
export async function latestSubmissionIdForContact(db, contactId) {
  if (!db) return null;
  try {
    const row = await db.prepare(
      `SELECT id FROM submissions WHERE contact_id = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(contactId).first();
    return row?.id || null;
  } catch (err) {
    console.warn(`[latestSubmissionIdForContact] D1 query failed for ${contactId}: ${err?.message || err}`);
    return null;
  }
}

/**
 * Return the Nth successful report in the contact's LATEST submission
 * chain. Used by `/report/{contactId}?v=N`.
 *
 * Scoping to one chain is deliberate — see latestSubmissionIdForContact.
 * `is_successful = 1` filter keeps retained-for-audit failed generations
 * out of customer-facing URLs; the reserved `?include=failed` audit path
 * will have its own query.
 *
 * @param {D1Database | null} db
 * @param {string} contactId
 * @param {number} version
 */
export async function reportByVersion(db, contactId, version) {
  if (!db) return null;
  const submissionId = await latestSubmissionIdForContact(db, contactId);
  if (!submissionId) return null;
  try {
    const row = await db.prepare(`
      SELECT * FROM report_versions
      WHERE submission_id = ? AND report_version = ? AND is_successful = 1
      LIMIT 1
    `).bind(submissionId, Number(version)).first();
    return hydrateReport(row);
  } catch (err) {
    console.warn(`[reportByVersion] D1 query failed for ${contactId} v${version}: ${err?.message || err}`);
    return null;
  }
}

/**
 * Return a specific report by its UUID. Used by
 * `/report/{contactId}?report_id=<uuid>`. Filters out failed generations
 * (`is_successful = 0`) so a leaked audit UUID cannot be served to a
 * customer.
 *
 * @param {D1Database | null} db
 * @param {string} reportId
 */
export async function reportById(db, reportId) {
  if (!db) return null;
  try {
    const row = await db.prepare(
      `SELECT * FROM report_versions WHERE id = ? AND is_successful = 1 LIMIT 1`
    ).bind(reportId).first();
    return hydrateReport(row);
  } catch (err) {
    console.warn(`[reportById] D1 query failed for ${reportId}: ${err?.message || err}`);
    return null;
  }
}

// --- Strategist feedback (Phase 3A) --------------------------------------
//
// The 16 approved feedback categories from docs/SOLOMON_ARCHITECTURE.md § 22.
// Enforced in code rather than CHECK CONSTRAINT so a new category can be
// added without a schema migration, but any value outside the set is
// rejected by insertFeedback.
export const FEEDBACK_TYPES = Object.freeze([
  "factual_error",
  "invented_fact",
  "tier_leakage",
  "causal_overreach",
  "severity_overstatement",
  "severity_understatement",
  "bad_calculation",
  "poor_personalization",
  "weak_opportunity",
  "generic_language",
  "incorrect_classification",
  "financial_terminology",
  "bad_cta",
  "missing_context",
  "great_output",
  "approved_example",
]);
const FEEDBACK_TYPES_SET = new Set(FEEDBACK_TYPES);

/** New UUID for a strategist_feedback row. */
export function newFeedbackId() {
  return crypto.randomUUID();
}

/**
 * Insert a strategist_feedback row. Feedback is capture-only at
 * Phase 3A — no automation reads from this table. `approved_for_learning`
 * is defaulted to 0; a separate human-gated review promotes rows to 1.
 *
 * Returns `{ok, id}` on success, or `{ok:false, reason}` for a shape
 * violation. The handler surfaces 400 on `reason:"invalid_feedback_type"`
 * or `reason:"missing_report_id"`; everything else is a hard throw.
 *
 * @param {D1Database | null} db
 * @param {{
 *   id?: string,
 *   report_id: string,
 *   submission_id?: string | null,
 *   contact_id?: string | null,
 *   finding_id?: string | null,
 *   feedback_type: string,
 *   original_output?: string | null,
 *   strategist_revision?: string | null,
 *   reason?: string | null,
 *   candidate_rule?: string | null,
 *   created_by?: string | null,
 * }} f
 */
export async function insertFeedback(db, f) {
  if (!f || typeof f !== "object") return { ok: false, reason: "missing_body" };
  if (!f.report_id || typeof f.report_id !== "string") {
    return { ok: false, reason: "missing_report_id" };
  }
  if (!FEEDBACK_TYPES_SET.has(f.feedback_type)) {
    return { ok: false, reason: "invalid_feedback_type", feedback_type: f.feedback_type };
  }
  if (!db) return { ok: true, skipped: true, reason: "no_db_binding" };
  const id = f.id || newFeedbackId();
  const now = Date.now();
  await db.prepare(`
    INSERT INTO strategist_feedback (
      id, report_id, submission_id, contact_id, finding_id,
      feedback_type, original_output, strategist_revision, reason,
      candidate_rule, approved_for_learning, approved_by, approved_at,
      created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
  `).bind(
    id,
    f.report_id,
    f.submission_id || null,
    f.contact_id || null,
    f.finding_id || null,
    f.feedback_type,
    f.original_output || null,
    f.strategist_revision || null,
    f.reason || null,
    f.candidate_rule || null,
    f.created_by || null,
    now,
  ).run();
  return { ok: true, id };
}

/**
 * Return every feedback row attached to a report, newest first. Used
 * by the strategist review UI (Phase 3B) to show the audit trail for
 * one report_id. Each row's JSON fields come back as plain strings
 * (nothing in this table is JSON-encoded today).
 *
 * @param {D1Database | null} db
 * @param {string} reportId
 */
export async function listFeedbackForReport(db, reportId) {
  if (!db || !reportId) return [];
  const { results } = await db.prepare(
    `SELECT * FROM strategist_feedback WHERE report_id = ? ORDER BY created_at DESC`
  ).bind(reportId).all();
  return (results || []).map(hydrateFeedback);
}

/**
 * Return pending feedback of a given type, newest first. Used by the
 * rule-promotion review queue (Phase 3C): if the same `feedback_type`
 * accumulates N rows, surface them for human review toward a candidate
 * rule. `approved_for_learning = 0` only.
 *
 * @param {D1Database | null} db
 * @param {string} feedbackType
 * @param {{ limit?: number }} [opts]
 */
export async function listPendingFeedbackByType(db, feedbackType, opts = {}) {
  if (!db || !feedbackType) return [];
  const requested = Number.isFinite(opts.limit) ? opts.limit : 100;
  const limit = Math.max(1, Math.min(500, requested));
  const { results } = await db.prepare(
    `SELECT * FROM strategist_feedback
       WHERE feedback_type = ? AND approved_for_learning = 0
       ORDER BY created_at DESC
       LIMIT ?`
  ).bind(feedbackType, limit).all();
  return (results || []).map(hydrateFeedback);
}

/**
 * Phase 3C — rule-promotion review queue summary.
 *
 * Returns one row per feedback_type that has at least one pending
 * (approved_for_learning = 0) and/or approved (= 1) record, with
 * both counts. Drives the Ask Solomon → Rule Promotions pane: the
 * strategist sees which categories have enough signal to promote.
 *
 * The two counts come back regardless of the type's position in
 * FEEDBACK_TYPES — categories with zero rows aren't returned.
 */
export async function pendingFeedbackSummary(db) {
  if (!db) return [];
  const { results } = await db.prepare(
    `SELECT feedback_type,
            SUM(CASE WHEN approved_for_learning = 0 THEN 1 ELSE 0 END) AS pending_count,
            SUM(CASE WHEN approved_for_learning = 1 THEN 1 ELSE 0 END) AS approved_count
       FROM strategist_feedback
       GROUP BY feedback_type
       ORDER BY pending_count DESC, feedback_type ASC`
  ).all();
  return (results || []).map(row => ({
    feedback_type: row.feedback_type,
    pending_count: Number(row.pending_count || 0),
    approved_count: Number(row.approved_count || 0),
  }));
}

/**
 * Phase 3C — list approved rows for one feedback_type (export view).
 * Newest first. Used by the "export approved batch" button to render
 * the human-authored candidate rules that are ready for the next
 * rubric_version bump.
 */
export async function listApprovedFeedbackByType(db, feedbackType, opts = {}) {
  if (!db || !feedbackType) return [];
  const requested = Number.isFinite(opts.limit) ? opts.limit : 100;
  const limit = Math.max(1, Math.min(500, requested));
  const { results } = await db.prepare(
    `SELECT * FROM strategist_feedback
       WHERE feedback_type = ? AND approved_for_learning = 1
       ORDER BY approved_at DESC, created_at DESC
       LIMIT ?`
  ).bind(feedbackType, limit).all();
  return (results || []).map(hydrateFeedback);
}

/**
 * Phase 3C — update a feedback row's approval state and/or its
 * strategist-authored candidate_rule text. Nothing else about a
 * feedback row is mutable from this layer (not report_id, not
 * feedback_type, not the strategist's original critique).
 *
 * Approving (approved_for_learning: true) stamps approved_by and
 * approved_at; unapproving clears them. The candidate_rule text can
 * be edited independently of the approval flag so a reviewer can
 * draft the rule, approve later.
 *
 * Returns {ok, updated: n, row} on success, {ok: false, reason} on
 * shape errors, and {ok: true, skipped: true, reason: "no_db_binding"}
 * when D1 isn't wired.
 */
export async function updateFeedback(db, id, patch) {
  if (!id || typeof id !== "string") return { ok: false, reason: "missing_id" };
  if (!patch || typeof patch !== "object") return { ok: false, reason: "missing_patch" };
  if (!db) return { ok: true, skipped: true, reason: "no_db_binding" };

  const sets = [];
  const binds = [];
  const now = Date.now();
  const hasApproval = Object.prototype.hasOwnProperty.call(patch, "approved_for_learning");
  const hasCandidateRule = Object.prototype.hasOwnProperty.call(patch, "candidate_rule");

  if (hasApproval) {
    const approving = patch.approved_for_learning === true || patch.approved_for_learning === 1;
    sets.push("approved_for_learning = ?");
    binds.push(approving ? 1 : 0);
    if (approving) {
      sets.push("approved_by = ?");
      sets.push("approved_at = ?");
      binds.push(typeof patch.approved_by === "string" && patch.approved_by ? patch.approved_by : "unknown");
      binds.push(now);
    } else {
      sets.push("approved_by = NULL");
      sets.push("approved_at = NULL");
    }
  }
  if (hasCandidateRule) {
    sets.push("candidate_rule = ?");
    binds.push(patch.candidate_rule == null ? null : String(patch.candidate_rule));
  }
  if (!sets.length) return { ok: false, reason: "nothing_to_update" };

  binds.push(id);
  const sql = `UPDATE strategist_feedback SET ${sets.join(", ")} WHERE id = ?`;
  const result = await db.prepare(sql).bind(...binds).run();
  const updated = result && result.meta ? Number(result.meta.changes || 0) : (result?.success ? 1 : 0);
  if (!updated) return { ok: false, reason: "not_found" };

  const row = await db.prepare(
    `SELECT * FROM strategist_feedback WHERE id = ? LIMIT 1`
  ).bind(id).first();
  return { ok: true, updated, row: hydrateFeedback(row) };
}

function hydrateFeedback(row) {
  if (!row) return null;
  return {
    id: row.id,
    report_id: row.report_id,
    submission_id: row.submission_id || null,
    contact_id: row.contact_id || null,
    finding_id: row.finding_id || null,
    feedback_type: row.feedback_type,
    original_output: row.original_output || null,
    strategist_revision: row.strategist_revision || null,
    reason: row.reason || null,
    candidate_rule: row.candidate_rule || null,
    approved_for_learning: row.approved_for_learning === 1 || row.approved_for_learning === true,
    approved_by: row.approved_by || null,
    approved_at: row.approved_at ? Number(row.approved_at) : null,
    created_by: row.created_by || null,
    created_at: Number(row.created_at),
  };
}

/**
 * Record a GHL writeback attempt. Each call appends a row; the latest row
 * per report_id gives the current sync state.
 *
 * @param {D1Database | null} db
 * @param {{ report_id: string, contact_id: string, status: 'pending'|'succeeded'|'failed', attempt_count?: number, error?: string | null }} s
 */
export async function recordGhlSyncAttempt(db, s) {
  if (!db) return { skipped: true, reason: "no_db_binding" };
  const now = Date.now();
  await db.prepare(`
    INSERT INTO ghl_sync (
      report_id, contact_id, status, attempt_count, last_error,
      last_attempt_at, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    s.report_id,
    s.contact_id,
    s.status,
    s.attempt_count ?? 1,
    s.error || null,
    now,
    s.status === "succeeded" ? now : null,
  ).run();
  return { ok: true };
}

// --- helpers --------------------------------------------------------------

function hydrateReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    submission_id: row.submission_id,
    contact_id: row.contact_id,
    tier: row.tier,
    report_version: Number(row.report_version),
    classification: row.classification || null,
    diagnostic: safeParse(row.diagnostic_json),
    strategist_brief: safeParse(row.strategist_brief_json),
    prompt_version: row.prompt_version || null,
    rubric_version: row.rubric_version || null,
    model_version: row.model_version || null,
    code_version: row.code_version || null,
    r2_html_key: row.r2_html_key || null,
    r2_html_bytes: row.r2_html_bytes ?? null,
    r2_html_sha256: row.r2_html_sha256 || null,
    created_at: Number(row.created_at),
    is_successful: row.is_successful === 1 || row.is_successful === true,
  };
}

function safeParse(s) {
  if (s === null || s === undefined) return null;
  if (typeof s !== "string") return s;
  // JSON parse failures are a data-integrity bug — surface, don't swallow.
  return JSON.parse(s);
}
