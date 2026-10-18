// BGA Copilot — learning loop (slice D of 5; customer directive
// 2026-10-17).
//
// Reads the per-case override log (bga_strategist_overrides, slice C)
// and projects repeated patterns into pending catalog-rule suggestions
// (bga_pending_rule_suggestions, migration 0006). A human must
// APPROVE a suggestion before any catalog change happens; approving
// here does NOT mutate bga_services — the admin still publishes the
// change through slice B's /asksolomon/catalog/publish flow.
//
// Four endpoints, all x-console-password-gated:
//   POST /asksolomon/catalog/suggestions/scan    → re-run aggregator; upsert pending rows
//   POST /asksolomon/catalog/suggestions         → list suggestions (default status: pending)
//   POST /asksolomon/catalog/suggestion/decide   → body {id, decision, by, note?} → set status
//   POST /asksolomon/catalog/suggestion          → body {id} → one row's full detail
//
// Aggregator semantics:
//   - Reads only NON-REVOKED overrides. Revoke means the strategist
//     took it back; it shouldn't feed the learning signal.
//   - Groups by (service_id, action). action in
//     {defer, not_a_fit, manual_add, edit_dependencies} contributes;
//     include + edit_reason do NOT (include is agreement with the
//     catalog, edit_reason is a per-case clarification that carries
//     no catalog-rule signal).
//   - Materiality threshold: a group needs OCCURRENCE_THRESHOLD or
//     more rows to become a suggestion. Below that it's noise.
//   - Each group's pattern_key is `${service_id}|${action}` so a
//     rescan upserts into the same row (occurrence_count + evidence
//     refreshed; status / decided_by / decision_note preserved).
//   - DISMISSED and APPLIED rows stay as-is on rescan — the admin's
//     call is sticky. If new overrides accumulate past
//     DISMISS_REOPEN_DELTA beyond the count at decision time, the
//     row is reopened to 'pending'; this stops a reasonable "we
//     looked at this three months ago" dismissal from permanently
//     hiding a pattern that keeps happening.

import { json } from "./case_handlers.js";

const OCCURRENCE_THRESHOLD = 2;         // minimum overrides to surface as a suggestion
const EVIDENCE_SAMPLE_LIMIT = 10;       // most-recent rows kept inline on the suggestion row
const DISMISS_REOPEN_DELTA = 3;         // dismissed → pending if new overrides push count by at least this much
const DECISIONS = new Set(["approved", "dismissed", "applied"]);

// Actions in the override log that the learning loop reads. include +
// edit_reason are deliberately omitted — see the module header.
const CONTRIBUTING_ACTIONS = new Set([
  "defer", "not_a_fit", "manual_add", "edit_dependencies",
]);

function _patternKey(serviceId, action) {
  return `${serviceId}|${action}`;
}

function _parseJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

// Builds a short human-readable summary for the admin UI. Kept
// imperative + specific so the admin sees what the pattern IS, not a
// generic "n cases flagged this".
function _summaryFor(action, serviceId, count, snippets) {
  const topReason = (snippets[0] || "").slice(0, 80);
  const tail = snippets.length > 1 ? ` (and ${snippets.length - 1} more)` : "";
  switch (action) {
    case "not_a_fit":
      return `${count} strategist overrides marked \`${serviceId}\` as not_a_fit — review hard_block or caution rules.${topReason ? ` Example reason: "${topReason}"${tail}` : ""}`;
    case "defer":
      return `${count} strategist overrides deferred \`${serviceId}\` — consider adding a defer_rule.${topReason ? ` Example reason: "${topReason}"${tail}` : ""}`;
    case "manual_add":
      return `${count} strategists added \`${serviceId}\` as a manual service — consider adding it to the catalog.${topReason ? ` Note: "${topReason}"${tail}` : ""}`;
    case "edit_dependencies":
      return `${count} strategists edited dependencies for \`${serviceId}\` — review the service's \`dependencies\` field.`;
    default:
      return `${count} overrides on \`${serviceId}\` (${action}).`;
  }
}

// Suggested-patch hint. Admin-facing only; the catalog admin page
// does NOT auto-apply this — the admin edits manually at
// /asksolomon/catalog.
function _proposedPatchFor(action, groupRows) {
  if (action === "manual_add") {
    const names = Array.from(new Set(groupRows.map((r) => {
      const p = _parseJson(r.payload_json, {});
      return typeof p.name === "string" ? p.name.trim() : "";
    }).filter(Boolean))).slice(0, EVIDENCE_SAMPLE_LIMIT);
    return { candidate_names: names };
  }
  if (action === "edit_dependencies") {
    // Union of proposed deps across rows (not an average — the admin
    // sees the full suggested set and decides what to keep).
    const depSet = new Set();
    for (const r of groupRows) {
      const p = _parseJson(r.payload_json, {});
      if (Array.isArray(p.deps)) p.deps.forEach((d) => depSet.add(String(d)));
    }
    return { proposed_deps: Array.from(depSet) };
  }
  if (action === "not_a_fit") {
    return { field: "hard_block_rules_or_caution_rules" };
  }
  if (action === "defer") {
    return { field: "defer_rules" };
  }
  return {};
}

/**
 * Reads non-revoked overrides, groups by (service_id, action) for
 * contributing actions, and upserts bga_pending_rule_suggestions.
 * Returns a report: { scanned, candidates, created, updated,
 * reopened, skipped, reconciled }.
 *
 * Three correctness fixes beyond the original (Codex P2 on #141):
 *
 * 1. COUNT in SQL first. The old implementation pulled every
 *    contributing row with LIMIT 5000 and grouped in JS. Past 5000
 *    rows that undercounted large groups and lost older
 *    (service_id, action) pairs entirely. We now do a GROUP BY in
 *    SQL to get accurate counts across the whole table, then fetch
 *    an EVIDENCE_SAMPLE_LIMIT-sized sample per qualifying group.
 *
 * 2. Reconcile existing rows whose contributors dropped. If strategist
 *    revokes shrink a group below OCCURRENCE_THRESHOLD — or clear it
 *    entirely — the old implementation just skipped it, leaving the
 *    existing suggestion row with its old (now stale) count and
 *    evidence. We now explicitly update such rows to the current
 *    non-revoked count (zero when all revoked) and refresh evidence.
 *
 * 3. Stable dismissal baseline. The reopen check used to compare the
 *    current count against `prior.occurrence_count`, but that column
 *    was advanced on every rescan of a dismissed row, so the delta
 *    was always 1. We now snapshot the count into dismissed_at_count
 *    at decide time (migration 0007) and compare against THAT.
 */
export async function _scanOverrides(env) {
  const db = env && env.SOLOMON_DB;
  if (!db) throw new Error("D1 unavailable");

  // 1a. Count every non-revoked contributing override per
  //     (service_id, action). GROUP BY runs in SQL — no row limit,
  //     so counts are accurate at any table size.
  const countRows = (await db
    .prepare(
      `SELECT service_id, action, COUNT(*) AS cnt
       FROM bga_strategist_overrides
       WHERE revoked_at IS NULL
         AND action IN ('defer','not_a_fit','manual_add','edit_dependencies')
       GROUP BY service_id, action`
    )
    .all()).results || [];

  // Build an index of (pattern_key → true count) so we can both
  // decide what qualifies and (later) reconcile existing rows
  // whose contributors have dropped away.
  const counts = new Map(); // key → { serviceId, action, count }
  let belowThreshold = 0;
  for (const r of countRows) {
    const cnt = Number(r.cnt) || 0;
    counts.set(_patternKey(r.service_id, r.action), {
      serviceId: r.service_id,
      action:    r.action,
      count:     cnt,
    });
    if (cnt < OCCURRENCE_THRESHOLD) belowThreshold++;
  }

  // 1b. Fetch an evidence sample for groups that qualify. One
  //     statement per qualifying group — cheap compared to pulling
  //     every row, and bounded by (service_id, action) × EVIDENCE_SAMPLE_LIMIT.
  const groups = new Map(); // key → { serviceId, action, count, rows[] }
  for (const [key, meta] of counts) {
    if (meta.count < OCCURRENCE_THRESHOLD) continue;
    const sampleRows = (await db
      .prepare(
        `SELECT id, contact_id, catalog_version_id, service_id, action,
                reason, payload_json, created_by, created_at
         FROM bga_strategist_overrides
         WHERE revoked_at IS NULL
           AND service_id = ? AND action = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .bind(meta.serviceId, meta.action, EVIDENCE_SAMPLE_LIMIT)
      .all()).results || [];
    groups.set(key, { ...meta, rows: sampleRows });
  }

  // Load existing suggestion rows so we can decide upsert vs
  // reopen vs reconcile without a hot loop of SELECTs.
  const existing = new Map();
  const existingRows = (await db
    .prepare(
      `SELECT id, pattern_key, service_id, action, status, occurrence_count,
              dismissed_at_count, decided_by, decided_at, decision_note
       FROM bga_pending_rule_suggestions`
    )
    .all()).results || [];
  for (const r of existingRows) existing.set(r.pattern_key, r);

  let created = 0, updated = 0, skipped = belowThreshold, reopened = 0, reconciled = 0;
  const nowIso = new Date().toISOString();

  // ─ Main pass: qualifying groups.
  for (const [key, g] of groups) {
    const sampled = g.rows.map((r) => ({
      override_id:         r.id,
      contact_id:          r.contact_id,
      catalog_version_id:  r.catalog_version_id,
      reason:              r.reason || "",
      created_by:          r.created_by,
      created_at:          r.created_at,
    }));
    const reasonSnippets = sampled.map((r) => (r.reason || "").trim()).filter(Boolean);
    const summary       = _summaryFor(g.action, g.serviceId, g.count, reasonSnippets);
    const proposedPatch = _proposedPatchFor(g.action, g.rows);
    const evidenceJson  = JSON.stringify(sampled);
    const proposedJson  = JSON.stringify(proposedPatch);

    const prior = existing.get(key);
    if (!prior) {
      await db
        .prepare(
          `INSERT INTO bga_pending_rule_suggestions
             (pattern_key, service_id, action, summary, evidence_json,
              proposed_patch_json, occurrence_count, status,
              first_seen_at, last_scanned_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        )
        .bind(key, g.serviceId, g.action, summary, evidenceJson, proposedJson, g.count, nowIso, nowIso)
        .run();
      created++;
    } else {
      // Reopen a dismissed suggestion when new overrides push count
      // past the configured delta — measured against the STABLE
      // dismissal baseline, not the ever-advancing occurrence_count.
      // Fallback to occurrence_count if dismissed_at_count is NULL
      // (row dismissed before migration 0007), so pre-migration
      // dismissals still get the sticky-until-N-more behavior.
      const baseline = prior.dismissed_at_count ?? prior.occurrence_count ?? 0;
      const shouldReopen =
        prior.status === "dismissed" &&
        (g.count - baseline) >= DISMISS_REOPEN_DELTA;
      if (shouldReopen) {
        await db
          .prepare(
            `UPDATE bga_pending_rule_suggestions
             SET summary = ?, evidence_json = ?, proposed_patch_json = ?,
                 occurrence_count = ?, status = 'pending',
                 decided_by = NULL, decided_at = NULL, decision_note = NULL,
                 dismissed_at_count = NULL,
                 last_scanned_at = ?
             WHERE id = ?`
          )
          .bind(summary, evidenceJson, proposedJson, g.count, nowIso, prior.id)
          .run();
        reopened++;
      } else {
        await db
          .prepare(
            `UPDATE bga_pending_rule_suggestions
             SET summary = ?, evidence_json = ?, proposed_patch_json = ?,
                 occurrence_count = ?, last_scanned_at = ?
             WHERE id = ?`
          )
          .bind(summary, evidenceJson, proposedJson, g.count, nowIso, prior.id)
          .run();
        updated++;
      }
    }
  }

  // ─ Reconcile pass: existing rows whose pattern no longer
  //   qualifies. Two sub-cases, both end with the row's count and
  //   evidence reflecting the ACTUAL non-revoked state:
  //     a) still present in `counts` but below threshold → set
  //        count to the real (small) number; leave status alone.
  //     b) absent from `counts` entirely (all contributors
  //        revoked) → set count to 0, clear evidence.
  for (const [key, prior] of existing) {
    if (groups.has(key)) continue; // handled in the main pass
    const metaBelow = counts.get(key);
    const realCount = metaBelow ? metaBelow.count : 0;
    // If the row's stored occurrence_count already matches reality
    // we can skip the write — avoids a no-op D1 round trip.
    if ((prior.occurrence_count || 0) === realCount) {
      if (realCount === 0) {
        // Still worth refreshing `last_scanned_at` so operators can
        // tell this row has been seen in the current scan.
        await db
          .prepare(
            `UPDATE bga_pending_rule_suggestions
             SET last_scanned_at = ?
             WHERE id = ?`
          )
          .bind(nowIso, prior.id)
          .run();
      }
      // Row already matches reality — no reconcile needed. Not
      // counted into `skipped` (which reports below-threshold
      // candidates, not up-to-date reconciliations).
      continue;
    }
    await db
      .prepare(
        `UPDATE bga_pending_rule_suggestions
         SET occurrence_count = ?, evidence_json = '[]',
             summary = ?, last_scanned_at = ?
         WHERE id = ?`
      )
      .bind(
        realCount,
        realCount === 0
          ? `All contributing overrides for \`${prior.service_id}\` (${prior.action}) have been revoked. No current signal.`
          : `${realCount} active overrides for \`${prior.service_id}\` (${prior.action}) — below the threshold of ${OCCURRENCE_THRESHOLD}.`,
        nowIso,
        prior.id
      )
      .run();
    reconciled++;
  }

  // Final count of contributing rows (sum of per-group counts) for
  // the report. Not every row got fetched into memory — we only
  // pulled sample windows — so we aggregate from the SQL counts.
  const scanned = countRows.reduce((n, r) => n + (Number(r.cnt) || 0), 0);
  return {
    scanned,
    candidates: counts.size,
    created,
    updated,
    reopened,
    reconciled,
    skipped,
  };
}

// POST /asksolomon/catalog/suggestions/scan — triggers aggregator.
export async function handleScanSuggestions(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  try {
    const report = await _scanOverrides(env);
    return json({ success: true, ...report });
  } catch (err) {
    return json({ success: false, error: err && err.message ? err.message : "scan failed" }, 503);
  }
}

// POST /asksolomon/catalog/suggestions — list suggestions.
// Body: { status?: "pending" | "approved" | "dismissed" | "applied" | "all" }
export async function handleListSuggestions(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { body = {}; }
  const requested = typeof body.status === "string" ? body.status.trim() : "pending";
  const validStatuses = new Set(["pending", "approved", "dismissed", "applied", "all"]);
  const status = validStatuses.has(requested) ? requested : "pending";

  const db = env && env.SOLOMON_DB;
  if (!db) return json({ success: false, error: "D1 unavailable" }, 503);

  const sql = status === "all"
    ? `SELECT * FROM bga_pending_rule_suggestions
       ORDER BY (status = 'pending') DESC, occurrence_count DESC, id DESC LIMIT 500`
    : `SELECT * FROM bga_pending_rule_suggestions
       WHERE status = ? ORDER BY occurrence_count DESC, id DESC LIMIT 500`;

  try {
    const stmt = status === "all" ? db.prepare(sql) : db.prepare(sql).bind(status);
    const rows = (await stmt.all()).results || [];
    const items = rows.map((r) => ({
      id:                 r.id,
      patternKey:         r.pattern_key,
      serviceId:          r.service_id,
      action:             r.action,
      summary:            r.summary,
      evidence:           _parseJson(r.evidence_json, []),
      proposedPatch:      _parseJson(r.proposed_patch_json, {}),
      occurrenceCount:    r.occurrence_count,
      dismissedAtCount:   r.dismissed_at_count ?? null,
      status:             r.status,
      decidedBy:          r.decided_by || null,
      decidedAt:          r.decided_at || null,
      decisionNote:       r.decision_note || null,
      firstSeenAt:        r.first_seen_at,
      lastScannedAt:      r.last_scanned_at,
    }));
    return json({ success: true, status, items });
  } catch (err) {
    return json({ success: false, error: `D1 read failed: ${err && err.message}` }, 503);
  }
}

// POST /asksolomon/catalog/suggestion — body: { id } → full detail
// (same shape as list items). Useful when a UI only has the id.
export async function handleGetSuggestion(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ success: false, error: "id must be a positive integer" }, 400);
  }
  const db = env && env.SOLOMON_DB;
  if (!db) return json({ success: false, error: "D1 unavailable" }, 503);
  try {
    const r = await db
      .prepare(`SELECT * FROM bga_pending_rule_suggestions WHERE id = ? LIMIT 1`)
      .bind(id)
      .first();
    if (!r) return json({ success: false, error: `suggestion ${id} not found` }, 404);
    return json({
      success: true,
      suggestion: {
        id: r.id,
        patternKey:      r.pattern_key,
        serviceId:       r.service_id,
        action:          r.action,
        summary:         r.summary,
        evidence:        _parseJson(r.evidence_json, []),
        proposedPatch:   _parseJson(r.proposed_patch_json, {}),
        occurrenceCount: r.occurrence_count,
        dismissedAtCount: r.dismissed_at_count ?? null,
        status:          r.status,
        decidedBy:       r.decided_by || null,
        decidedAt:       r.decided_at || null,
        decisionNote:    r.decision_note || null,
        firstSeenAt:     r.first_seen_at,
        lastScannedAt:   r.last_scanned_at,
      },
    });
  } catch (err) {
    return json({ success: false, error: `D1 read failed: ${err && err.message}` }, 503);
  }
}

// POST /asksolomon/catalog/suggestion/decide — set status.
// Body: { id, decision: 'approved'|'dismissed'|'applied', by, note? }
export async function handleDecideSuggestion(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const id        = Number(body.id);
  const decision  = typeof body.decision === "string" ? body.decision.trim() : "";
  const decidedBy = typeof body.by === "string" ? body.by.trim() : "";
  const note      = typeof body.note === "string" ? body.note.trim() : "";

  if (!Number.isInteger(id) || id <= 0) {
    return json({ success: false, error: "id must be a positive integer" }, 400);
  }
  if (!decidedBy) return json({ success: false, error: "by (operator identifier) required" }, 400);
  if (!DECISIONS.has(decision)) {
    return json({ success: false, error: `decision must be one of: ${[...DECISIONS].join(", ")}` }, 400);
  }
  // 'dismissed' requires a note — a silent "no" loses useful signal
  // for the next admin who re-reads the aggregator output.
  if (decision === "dismissed" && !note) {
    return json({ success: false, error: 'decision "dismissed" requires a non-empty note' }, 400);
  }

  const db = env && env.SOLOMON_DB;
  if (!db) return json({ success: false, error: "D1 unavailable" }, 503);
  try {
    const row = await db
      .prepare(`SELECT id, status FROM bga_pending_rule_suggestions WHERE id = ? LIMIT 1`)
      .bind(id)
      .first();
    if (!row) return json({ success: false, error: `suggestion ${id} not found` }, 404);

    const nowIso = new Date().toISOString();
    // Codex P2 on #141: snapshot the dismissal baseline. The
    // reopen rule in _scanOverrides compares current overrides
    // against this frozen count. Any non-dismiss decision clears
    // the snapshot so a later dismissal resets it correctly.
    if (decision === "dismissed") {
      await db
        .prepare(
          `UPDATE bga_pending_rule_suggestions
           SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?,
               dismissed_at_count = occurrence_count
           WHERE id = ?`
        )
        .bind(decision, decidedBy, nowIso, note || null, id)
        .run();
    } else {
      await db
        .prepare(
          `UPDATE bga_pending_rule_suggestions
           SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?,
               dismissed_at_count = NULL
           WHERE id = ?`
        )
        .bind(decision, decidedBy, nowIso, note || null, id)
        .run();
    }
    return json({ success: true, id, status: decision, decidedBy, decidedAt: nowIso });
  } catch (err) {
    return json({ success: false, error: `decision write failed: ${err && err.message}` }, 503);
  }
}
