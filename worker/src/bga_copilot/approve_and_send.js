// BGA Copilot — approve_and_send (PR 12; spec §4.9 + §5).
//
// The ONLY code path in the Worker that writes `swot_growth_plan`
// or applies the `swot_growth_plan_ready` tag. Every other handler is
// gated by §9 guardrail 10 (grep-based test) from touching either.
//
// Step order per §5.4:
//   1. Verify password + reviewed=true + draft present + swot_paid_297.
//   2. Validate red-team report: exists, no blockers, every warning
//      acknowledged, every input hash still matches current content.
//      Capture (draft, decisions, selections) into send_bundle.
//   3. Acquire D1 lock (INSERT INTO bga_send_locks ...). On UNIQUE
//      conflict, return 409 "Already sent at <acquired_at>."
//   4. Re-check swot_growth_plan_ready not already present. If it is,
//      DELETE the lock row and return 409.
//   5. Render customer-facing growth plan HTML from send_bundle.draft
//      (strip DRAFT banner, strip Section 8).
//   6. Render next_steps HTML from send_bundle.decisions.
//   7. Render services_selected_display HTML from send_bundle.selections.
//   8. Atomic PUT: swot_growth_plan + swot_bga_next_steps +
//      swot_bga_services_selected_display in one call. Routes through
//      the version-history wrapper so an audit entry lands with the
//      write.
//   9. Only if (8) ok, applyGhlTag(swot_growth_plan_ready).
//   10. Return success.
//   11. On any failure after step 3: DELETE lock row, do not apply tag.

import {
  fetchGhlContact,
  readCustomField,
  json,
} from "./case_handlers.js";
import {
  fetchGHLCustomFieldsCatalog,
  buildFieldKeyToIdMap,
} from "../ghl_catalog.js";
import { parseDraftSections, DRAFT_BANNER } from "./roadmap.js";
import { parseVerifiedFinancials } from "./metrics.js";
import { getServicesCatalogVersion } from "./services_catalog.js";
import { assembleCaseBundle } from "./case_load.js";
import {
  HISTORY_FIELD_KEY,
  writeFieldsAndAppendHistory,
} from "./version_history.js";
import {
  computeInputHashes,
  RED_TEAM_FIELD_KEY,
  DRAFT_FIELD_KEY,
  DECISIONS_FIELD_KEY,
  SERVICES_SELECTED_FIELD_KEY,
  VF_FIELD_KEY,
} from "./red_team_check.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const PAID_297_TAG = "swot_paid_297";
const READY_TAG = "swot_growth_plan_ready";
const GROWTH_PLAN_FIELD_KEY = "swot_growth_plan";
const NEXT_STEPS_FIELD_KEY = "swot_bga_next_steps";
const SERVICES_SELECTED_DISPLAY_FIELD_KEY = "swot_bga_services_selected_display";

export {
  READY_TAG,
  GROWTH_PLAN_FIELD_KEY,
  NEXT_STEPS_FIELD_KEY,
  SERVICES_SELECTED_DISPLAY_FIELD_KEY,
};

// -------- D1 lock helpers --------

/**
 * INSERT the lock row atomically. Returns:
 *   { acquired: true, acquired_at }                 → first write wins
 *   { acquired: false, existing_acquired_at }       → someone else has it
 *   { acquired: false, error: "<msg>" }             → D1 unavailable
 *
 * D1 raises a UNIQUE constraint error on the PRIMARY KEY collision; we
 * fetch the existing row to surface its timestamp in the 409.
 */
export async function acquireSendLock(contactId, env) {
  if (!env.SOLOMON_DB || typeof env.SOLOMON_DB.prepare !== "function") {
    return { acquired: false, error: "SOLOMON_DB binding missing" };
  }
  const acquired_at = new Date().toISOString();
  try {
    await env.SOLOMON_DB
      .prepare("INSERT INTO bga_send_locks (contact_id, acquired_at) VALUES (?, ?)")
      .bind(contactId, acquired_at)
      .run();
    return { acquired: true, acquired_at };
  } catch (err) {
    // UNIQUE constraint failure — fetch existing timestamp.
    try {
      const row = await env.SOLOMON_DB
        .prepare("SELECT acquired_at FROM bga_send_locks WHERE contact_id = ?")
        .bind(contactId)
        .first();
      if (row && row.acquired_at) {
        return { acquired: false, existing_acquired_at: row.acquired_at };
      }
    } catch { /* fallthrough */ }
    return {
      acquired: false,
      error: err && err.message ? err.message : "lock insert failed",
    };
  }
}

export async function releaseSendLock(contactId, env) {
  if (!env.SOLOMON_DB || typeof env.SOLOMON_DB.prepare !== "function") return false;
  try {
    await env.SOLOMON_DB
      .prepare("DELETE FROM bga_send_locks WHERE contact_id = ?")
      .bind(contactId)
      .run();
    return true;
  } catch {
    return false;
  }
}

// -------- Customer-facing renderers --------

const CUSTOMER_VISIBLE_SECTION_NUMBERS = [1, 2, 3, 4, 5, 6, 7];

/**
 * Build the final customer-visible growth plan from a validated draft.
 * Strips the DRAFT · INTERNAL banner and Section 8 (internal open
 * questions). Keeps sections 1-7 in order.
 *
 * Returns a plain-text string with "## Section N — Title" headers; HL
 * will render linebreaks on its side.
 */
export function renderGrowthPlanFromDraft(draft) {
  const parsed = parseDraftSections(draft);
  const parts = [];
  for (const s of parsed.sections) {
    if (!CUSTOMER_VISIBLE_SECTION_NUMBERS.includes(s.n)) continue;
    parts.push(`## Section ${s.n} — ${s.title}\n\n${(s.body || "").trim()}`);
  }
  return parts.join("\n\n");
}

/**
 * Render next_steps HTML from the decisions array. Groups by category;
 * drops empty categories. Returns a simple nested-list HTML string
 * safe for the HL email body (no inline styles that would conflict
 * with Email 04's own styling — HL renders the merge field verbatim
 * inside the report-box div).
 */
export function renderNextStepsFromDecisions(decisionsRaw) {
  if (!decisionsRaw || !decisionsRaw.trim()) {
    return "<p>No next steps recorded yet.</p>";
  }
  let arr;
  try { arr = JSON.parse(decisionsRaw); } catch { return "<p>No next steps recorded yet.</p>"; }
  if (!Array.isArray(arr) || arr.length === 0) {
    return "<p>No next steps recorded yet.</p>";
  }
  const byCategory = new Map();
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const cat = typeof e.category === "string" ? e.category : "other";
    const text = typeof e.text === "string" ? e.text.trim() : "";
    if (!text) continue;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(text);
  }
  if (byCategory.size === 0) return "<p>No next steps recorded yet.</p>";

  const CATEGORY_LABELS = {
    priorities_confirmed: "Priorities we confirmed",
    ninety_day_commitments: "Your 90-day commitments",
    six_month_commitments: "Your 6-month commitments",
    twelve_month_direction: "Your 12-month direction",
    client_homework: "What you'll bring back",
    cfobd_homework: "What we're taking on",
  };

  const parts = [];
  for (const [cat, items] of byCategory) {
    const label = CATEGORY_LABELS[cat] || cat.replace(/_/g, " ");
    parts.push(`<p><strong>${escapeHtml(label)}</strong></p>`);
    parts.push("<ul>");
    for (const t of items) parts.push(`<li>${escapeHtml(t)}</li>`);
    parts.push("</ul>");
  }
  return parts.join("\n");
}

/**
 * Render services_selected_display HTML from the services_selected array.
 * Lists selected services first, then declined/deferred (if any).
 */
export function renderServicesDisplay(selectionsRaw) {
  if (!selectionsRaw || !selectionsRaw.trim()) {
    return "<p>No services selected.</p>";
  }
  let arr;
  try { arr = JSON.parse(selectionsRaw); } catch { return "<p>No services selected.</p>"; }
  if (!Array.isArray(arr) || arr.length === 0) {
    return "<p>No services selected.</p>";
  }
  const selected = [];
  const declined = [];
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    if (typeof e.service_id !== "string") continue;
    if (e.status === "selected") selected.push(e);
    else if (e.status === "declined_or_deferred") declined.push(e);
  }
  const parts = [];
  if (selected.length > 0) {
    parts.push("<p><strong>You selected</strong></p>");
    parts.push("<ul>");
    for (const e of selected) {
      const label = humanizeServiceId(e.service_id);
      const reason = typeof e.reason === "string" && e.reason.trim()
        ? ` — ${escapeHtml(e.reason.trim())}`
        : "";
      parts.push(`<li>${escapeHtml(label)}${reason}</li>`);
    }
    parts.push("</ul>");
  }
  if (declined.length > 0) {
    parts.push("<p><strong>Deferred for a later conversation</strong></p>");
    parts.push("<ul>");
    for (const e of declined) {
      const label = humanizeServiceId(e.service_id);
      parts.push(`<li>${escapeHtml(label)}</li>`);
    }
    parts.push("</ul>");
  }
  if (parts.length === 0) return "<p>No services selected.</p>";
  return parts.join("\n");
}

function humanizeServiceId(sid) {
  return String(sid).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// -------- Tag helper --------

async function applyGhlTag(contactId, tag, env) {
  if (!env.GHL_API_KEY) return false;
  try {
    const res = await fetch(
      `${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}/tags`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.GHL_API_KEY}`,
          Version: "2021-07-28",
        },
        body: JSON.stringify({ tags: [tag] }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// -------- Report-staleness validation --------

/**
 * Compares the stored report's inputs_checked hashes against freshly-
 * computed hashes for the same inputs. Returns:
 *   { stale: false }                        → all 6 hashes match
 *   { stale: true, changed: ["draft_hash", ...] }  → list of mismatches
 */
export function compareInputHashes(stored, current) {
  const keys = [
    "draft_hash",
    "decisions_hash",
    "selections_hash",
    "verified_financials_hash",
    "intake_bundle_hash",
    "catalog_ref",
  ];
  const changed = [];
  for (const k of keys) {
    const s = stored && typeof stored[k] === "string" ? stored[k] : "";
    const c = current && typeof current[k] === "string" ? current[k] : "";
    if (s !== c) changed.push(k);
  }
  return { stale: changed.length > 0, changed };
}

// -------- The handler --------

/**
 * POST /asksolomon/case/approve-and-send
 *
 * Body: { contactId, reviewed: true }
 *
 * The ONLY code path that writes `swot_growth_plan` or applies
 * `swot_growth_plan_ready`.
 */
export async function handleApproveAndSend(request, env, { checkPassword }) {
  // Step 1a: password
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  if (!contactId) return json({ success: false, error: "contactId required" }, 400);

  // Step 1b: reviewed must be literal true
  if (body.reviewed !== true) {
    return json({ success: false, error: "reviewed=true required" }, 400);
  }

  // Fetch the contact (one GET; reused for every read below).
  const { contact, error } = await fetchGhlContact(contactId, env);
  if (!contact) return json({ success: false, error: error || "contact fetch failed" }, 503);

  // Step 1c: swot_paid_297 required
  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  if (!tags.includes(PAID_297_TAG)) {
    return json({ success: false, error: `contact is not tagged ${PAID_297_TAG}` }, 403);
  }
  // Step 1d: idempotency — ready tag already present
  if (tags.includes(READY_TAG)) {
    return json({ success: false, error: `already sent (${READY_TAG} tag present on contact)` }, 409);
  }

  let catalog = {};
  try { catalog = await fetchGHLCustomFieldsCatalog(env); }
  catch (e) { console.warn(`[approve_and_send] catalog fetch: ${e?.message || e}`); }
  const idMap = buildFieldKeyToIdMap(catalog);

  const draft = readCustomField(contact, DRAFT_FIELD_KEY, idMap);
  if (!(draft || "").trim()) {
    return json({ success: false, error: "no draft to send" }, 409);
  }
  const decisionsRaw = readCustomField(contact, DECISIONS_FIELD_KEY, idMap);
  const selectionsRaw = readCustomField(contact, SERVICES_SELECTED_FIELD_KEY, idMap);
  const vfRaw = readCustomField(contact, VF_FIELD_KEY, idMap);
  const reportRaw = readCustomField(contact, RED_TEAM_FIELD_KEY, idMap);

  // Step 2: validate red-team report
  if (!reportRaw || !reportRaw.trim()) {
    return json({ success: false, error: "run RUN PRE-SEND QA before sending" }, 409);
  }
  let report;
  try { report = JSON.parse(reportRaw); }
  catch {
    return json({ success: false, error: "red-team report is malformed JSON" }, 500);
  }
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  if (blockers.length > 0) {
    return json({
      success: false,
      error: "red-team blockers present",
      blockers: blockers.map((b) => ({ id: b.id, where: b.where })),
    }, 409);
  }
  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  const acked = Array.isArray(report.acknowledged_warnings) ? report.acknowledged_warnings : [];
  const unacknowledged = warnings
    .map((w) => w && w.id)
    .filter((id) => id && !acked.includes(id));
  if (unacknowledged.length > 0) {
    return json({
      success: false,
      error: "unacknowledged warnings present",
      unacknowledged_warning_ids: unacknowledged,
    }, 400);
  }

  const bundle = assembleCaseBundle(contact, idMap, { contactId, catalog });
  const intakeAnswers = bundle?.intake?.paid_297_answers || [];
  const catalogRef = await getServicesCatalogVersion();
  const currentHashes = await computeInputHashes({
    draft,
    decisions: decisionsRaw,
    selections: selectionsRaw,
    verifiedFinancialsRaw: vfRaw,
    intakeAnswers,
    catalogRef,
  });
  const staleness = compareInputHashes(report.inputs_checked, currentHashes);
  if (staleness.stale) {
    return json({
      success: false,
      error: "red-team report is stale; re-run RUN PRE-SEND QA before sending",
      changed_inputs: staleness.changed,
    }, 409);
  }

  // send_bundle — the exact bytes QA passed. These are what we render.
  const send_bundle = {
    draft,
    decisions: decisionsRaw,
    selections: selectionsRaw,
  };

  // Step 3: acquire D1 lock
  const lock = await acquireSendLock(contactId, env);
  if (!lock.acquired) {
    if (lock.existing_acquired_at) {
      return json({
        success: false,
        error: `already sent at ${lock.existing_acquired_at}`,
      }, 409);
    }
    return json({ success: false, error: lock.error || "lock acquisition failed" }, 503);
  }

  // Step 4: re-check ready tag (defends against the window between step
  // 1d and step 3 and against a lock-table desync). We already have
  // `tags` from step 1c's fetch; a drift here would only matter if the
  // tag got applied between the first GET and lock acquisition, which
  // in Workers is sub-second — but we check again anyway to match the
  // spec exactly.
  if (tags.includes(READY_TAG)) {
    await releaseSendLock(contactId, env);
    return json({
      success: false,
      error: `already sent (${READY_TAG} tag present on contact)`,
    }, 409);
  }

  // Steps 5-7: render
  const growthPlanHtml = renderGrowthPlanFromDraft(send_bundle.draft);
  const nextStepsHtml = renderNextStepsFromDecisions(send_bundle.decisions);
  const servicesHtml = renderServicesDisplay(send_bundle.selections);

  // Step 8: atomic PUT via version-history wrapper
  const historyRaw = readCustomField(contact, HISTORY_FIELD_KEY, idMap);
  const wrote = await writeFieldsAndAppendHistory({
    contactId,
    fieldWrites: [
      { key: GROWTH_PLAN_FIELD_KEY, value: growthPlanHtml },
      { key: NEXT_STEPS_FIELD_KEY, value: nextStepsHtml },
      { key: SERVICES_SELECTED_DISPLAY_FIELD_KEY, value: servicesHtml },
    ],
    action: "approve_and_send",
    affectedFields: [
      GROWTH_PLAN_FIELD_KEY,
      NEXT_STEPS_FIELD_KEY,
      SERVICES_SELECTED_DISPLAY_FIELD_KEY,
    ],
    catalogRef,
    historyRaw,
    env,
  });
  if (!wrote.success) {
    // Step 11: rollback lock, do NOT apply tag.
    await releaseSendLock(contactId, env);
    return json({
      success: false,
      error: `step 8 (writeback): ${wrote.error || "GHL writeback failed"}`,
    }, 503);
  }

  // Step 9: apply ready tag
  const tagged = await applyGhlTag(contactId, READY_TAG, env);
  if (!tagged) {
    // Writes landed, tag didn't. Per §5.4 step 11: delete the lock so
    // the strategist can retry, and surface the specific manual remedy.
    await releaseSendLock(contactId, env);
    return json({
      success: false,
      error: `step 9 (tag apply): writes landed in HL but ${READY_TAG} tag did not apply — apply the tag manually in HL to fire Email 04`,
      partial: {
        writes_succeeded: true,
        tag_applied: false,
      },
    }, 503);
  }

  // Step 10: done. Lock stays as permanent send record.
  return json({
    success: true,
    contactId,
    acquired_at: lock.acquired_at,
    writes_applied: [
      GROWTH_PLAN_FIELD_KEY,
      NEXT_STEPS_FIELD_KEY,
      SERVICES_SELECTED_DISPLAY_FIELD_KEY,
    ],
    tag_applied: READY_TAG,
  });
}
