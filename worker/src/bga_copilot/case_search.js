// BGA Copilot — case search endpoint.
//
// Replaces the raw "paste a GHL Contact ID" loader on /asksolomon/case
// with a strategist-friendly search over swot_paid_297 contacts.
//
// Spec reference: PR 125 ("search PR") following docs/BGA_COPILOT_SPEC.md
// §2.1 — same case-load path, just a human-friendly way to pick which
// contactId to load.
//
// Scope — this is a READ-ONLY lookup. It never writes to a contact, never
// applies a tag, never computes a report. The returned contactIds feed
// right back into the existing /asksolomon/case/load handler, which
// remains the single owner of case-bundle assembly.
//
// Security — password-gated via the shared console password / embed
// token (same as every other /asksolomon/case/* handler).
//
// Scale note — today the BGA cohort is a handful of contacts, so the
// free-text filter (q over name/company/email) runs IN-MEMORY against
// the full swot_paid_297 page the GHL search returns. When the cohort
// grows past ~500, switch the free-text match to GHL's own `query`
// body param (GHL /contacts/search supports it) and keep this module's
// badge-computation unchanged.
//
// Tags recognized today (see case_load.js, approve_and_send.js, etc.):
//   - swot_paid_297          — BGA buyer. Required to appear in results.
//   - swot_growth_plan_ready — Worker-applied at approve_and_send only.
//                              Terminal "sent" state.
// There is NO swot_bga_call_booked / swot_bga_call_completed tag in the
// system today. Badges below infer call readiness from the presence of
// the strategist-generated artifacts (prep brief, red-team report)
// rather than call-lifecycle tags.

import { fetchGHLCustomFieldsCatalog, buildFieldKeyToIdMap } from "../ghl_catalog.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

const PAID_297_TAG = "swot_paid_297";
const SENT_TAG = "swot_growth_plan_ready";

const VERIFIED_FINANCIALS_FIELD_KEY = "swot_verified_financials";
const DRAFT_FIELD_KEY = "swot_growth_plan_draft";
const PREP_BRIEF_FIELD_KEY = "swot_bga_prep_brief";
const RED_TEAM_FIELD_KEY = "swot_bga_red_team_report";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Local JSON responder — same shape as case_handlers' json(). We keep a
 * copy here rather than importing case_handlers.js so this module stays
 * independent of the fetch helpers it doesn't need.
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Read a specific custom field from a contact's customFields array,
 * resolving the field by its fieldKey through the catalog idMap.
 *
 * Contact fetch endpoints return customFields as bare {id, value};
 * fieldKey isn't echoed. Hence the id lookup through the shared idMap.
 *
 * Returns "" when the field isn't present or its value is empty/null.
 */
function readFieldValue(contact, fieldKey, idMap) {
  if (!contact || !Array.isArray(contact.customFields)) return "";
  const id = idMap[fieldKey];
  if (!id) return "";
  const entry = contact.customFields.find((f) => f && f.id === id);
  if (!entry) return "";
  const v = entry.value;
  if (v == null) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

/**
 * Compute workflow-state badges for a BGA contact.
 *
 * Top-priority badge wins (first match returns). Order matches the
 * natural case lifecycle, so a case is always in exactly one bucket:
 *   sent → ready-to-finalize → ready-for-call → needs-roadmap →
 *   needs-financials (default).
 *
 * Why this ordering: once the Worker applies swot_growth_plan_ready
 * the case is terminally delivered; before that, the strategist's
 * generated artifacts (red-team report → prep brief → roadmap draft)
 * mark the progression. verified_financials being empty is the
 * default starting state for a fresh buyer.
 */
export function computeBadges(contact, idMap) {
  const tags = Array.isArray(contact.tags) ? contact.tags : [];

  if (tags.includes(SENT_TAG)) {
    return { status: "sent", badges: ["sent"] };
  }

  const vf = readFieldValue(contact, VERIFIED_FINANCIALS_FIELD_KEY, idMap).trim();
  const draft = readFieldValue(contact, DRAFT_FIELD_KEY, idMap).trim();
  const prep = readFieldValue(contact, PREP_BRIEF_FIELD_KEY, idMap).trim();
  const redTeam = readFieldValue(contact, RED_TEAM_FIELD_KEY, idMap).trim();

  if (vf && draft && redTeam) {
    return { status: "ready-to-finalize", badges: ["ready-to-finalize"] };
  }
  if (vf && draft && prep) {
    return { status: "ready-for-call", badges: ["ready-for-call"] };
  }
  if (vf && !draft) {
    return { status: "needs-roadmap", badges: ["needs-roadmap"] };
  }
  if (!vf) {
    return { status: "needs-financials", badges: ["needs-financials"] };
  }

  // vf + draft present, no prep brief or red-team yet — strategist has
  // started the plan but hasn't prepared for the call. Treat as
  // "needs-roadmap" so it still surfaces as needing attention; the
  // specific missing step is visible on the case page.
  return { status: "needs-roadmap", badges: ["needs-roadmap"] };
}

/**
 * Build the display-friendly card row for one GHL contact.
 */
function toCard(contact, idMap) {
  const { status, badges } = computeBadges(contact, idMap);
  const firstName = contact.firstName || "";
  const lastName = contact.lastName || "";
  const name = (contact.contactName
    || [firstName, lastName].filter(Boolean).join(" ").trim()
    || "(no name)");
  return {
    contactId: contact.id,
    name,
    firstName,
    lastName,
    company: contact.companyName || contact.businessName || "",
    email: contact.email || "",
    tags: Array.isArray(contact.tags) ? contact.tags : [],
    status,
    badges,
    // dateUpdated is the most recent write (field update or tag flip) —
    // "days since BGA activity" is approximated from it. The exact
    // "swot_paid_297 applied at" timestamp isn't exposed by GHL's
    // search endpoint and the swot_paid_297_applied_at custom field
    // isn't universally populated yet (see case_load.js line ~278).
    updatedAt: contact.dateUpdated || contact.dateAdded || null,
    purchasedAt: contact.dateAdded || null,
  };
}

/**
 * Case-insensitive substring match across name, company and email.
 * Scale note at top of file: this runs in memory because the swot_paid_297
 * cohort is small today; swap to GHL's `query` body param when it grows.
 */
function matchesQuery(card, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  const haystacks = [card.name, card.company, card.email, card.firstName, card.lastName];
  return haystacks.some((s) => typeof s === "string" && s.toLowerCase().includes(needle));
}

/**
 * Fetch the full swot_paid_297 page from GHL. Returns {contacts, error}.
 *
 * The GHL endpoint we call here is POST /contacts/search (v2021-07-28).
 * We filter server-side by the tag so the Worker never sees non-BGA
 * contacts. pageLimit is capped at 100 — that's the hard GHL cap and
 * also enough for the current cohort by a wide margin.
 */
async function fetchBgaCohort(env) {
  if (!env.GHL_API_KEY) return { contacts: null, error: "GHL_API_KEY not configured" };
  const locationId = env.GHL_LOCATION_ID;
  if (!locationId) return { contacts: null, error: "GHL_LOCATION_ID not configured" };

  const body = {
    locationId,
    pageLimit: 100,
    filters: [
      { field: "tags", operator: "contains", value: PAID_297_TAG },
    ],
    sort: [{ field: "dateUpdated", direction: "desc" }],
  };

  try {
    const res = await fetch(`${GHL_API_BASE}/contacts/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GHL_API_KEY}`,
        "Content-Type": "application/json",
        Version: "2021-07-28",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        contacts: null,
        error: `GHL search ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = await res.json().catch(() => ({}));
    const contacts = Array.isArray(data?.contacts) ? data.contacts : [];
    return { contacts, error: null };
  } catch (err) {
    return { contacts: null, error: `GHL search error: ${err?.message || err}` };
  }
}

/**
 * POST /asksolomon/case/search — password-gated BGA case picker.
 *
 * Body: { q?: string, limit?: number }
 *   - q: free-text match against name, company, email (case-insensitive
 *        substring). Empty / omitted returns the full cohort.
 *   - limit: 1..100, defaults to 25.
 *
 * Response (200):
 *   {
 *     success: true,
 *     total: <int>,              // pre-limit count after q filter
 *     contacts: [
 *       {contactId, name, firstName, lastName, company, email, tags,
 *        status, badges, updatedAt, purchasedAt}
 *     ],
 *   }
 *
 * Refusals:
 *   401 — console password missing / wrong
 *   400 — invalid JSON
 *   503 — GHL unreachable, catalog unavailable, GHL non-ok
 */
export async function handleCaseSearch(request, env, { checkPassword }) {
  if (!checkPassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  let body = {};
  if (request.method === "POST") {
    try { body = await request.json(); }
    catch { return json({ success: false, error: "Invalid JSON body" }, 400); }
  }

  const q = typeof body?.q === "string" ? body.q.trim() : "";
  let limit = Number.isFinite(body?.limit) ? Math.floor(body.limit) : DEFAULT_LIMIT;
  if (limit < 1) limit = 1;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  let catalog = {};
  try { catalog = await fetchGHLCustomFieldsCatalog(env); }
  catch (e) {
    return json({
      success: false,
      error: `catalog unavailable: ${e?.message || e}`,
    }, 503);
  }
  const idMap = buildFieldKeyToIdMap(catalog);

  const { contacts, error } = await fetchBgaCohort(env);
  if (contacts == null) {
    return json({ success: false, error: error || "cohort fetch failed" }, 503);
  }

  // Defensive filter — the tag filter above should already keep this
  // true, but we double-check so a stray miss can never leak a
  // non-BGA contact into the strategist console.
  const bgaOnly = contacts.filter((c) => {
    const tags = Array.isArray(c?.tags) ? c.tags : [];
    return tags.includes(PAID_297_TAG);
  });

  const cards = bgaOnly.map((c) => toCard(c, idMap));
  const filtered = cards.filter((card) => matchesQuery(card, q));
  const trimmed = filtered.slice(0, limit);

  return json({
    success: true,
    total: filtered.length,
    contacts: trimmed,
  });
}
