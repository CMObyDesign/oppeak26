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
  const row = await db.prepare(`
    SELECT * FROM report_versions
    WHERE contact_id = ? AND is_successful = 1
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(contactId).first();
  return hydrateReport(row);
}

/**
 * Return a specific report_version for a contact's latest submission chain.
 * Used by /report/{contactId}?v=N.
 *
 * @param {D1Database | null} db
 * @param {string} contactId
 * @param {number} version
 */
export async function reportByVersion(db, contactId, version) {
  if (!db) return null;
  const row = await db.prepare(`
    SELECT rv.* FROM report_versions rv
    WHERE rv.contact_id = ? AND rv.report_version = ?
    ORDER BY rv.created_at DESC
    LIMIT 1
  `).bind(contactId, Number(version)).first();
  return hydrateReport(row);
}

/**
 * Return a specific report by its UUID. Used by /report/{contactId}?report_id=.
 * @param {D1Database | null} db
 * @param {string} reportId
 */
export async function reportById(db, reportId) {
  if (!db) return null;
  const row = await db.prepare(
    `SELECT * FROM report_versions WHERE id = ? LIMIT 1`
  ).bind(reportId).first();
  return hydrateReport(row);
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
