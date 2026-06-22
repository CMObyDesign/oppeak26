/**
 * CFO By Design — SWOT Engine Worker v3
 * Agent-assessed funnel.
 *
 * Flow: form answers -> Claude assesses (Miguel's logic) + writes the report
 *       -> structured JSON that the front-end renders directly.
 *
 * The worker is QUESTION-AGNOSTIC: it accepts whatever labeled question/answer
 * pairs the form sends, so it works with the current questions and with v3.
 *
 * Runtime secrets (set in Cloudflare dashboard): ANTHROPIC_API_KEY, GHL_API_KEY
 */

const CONFIG = {
  CLAUDE_MODEL: "claude-sonnet-4-6",
  ANTHROPIC_VERSION: "2023-06-01",
  GHL_API_BASE: "https://services.leadconnectorhq.com",
  GHL_LOCATION_ID: "oLIENQCtGnt9U6gfLhE5",
  BOOKING_LINK_47: "https://my.cfobydesign.com/widget/booking/D3yNZNFtqIYsChkOgQc9",
  BOOKING_LINK_297: "https://my.cfobydesign.com/widget/booking/VGdN6KoFBtbdnSvHKHTh",
  PAYMENT_LINK_47: "https://my.cfobydesign.com/payment-link/6a0db7aa1a6dcdeebb53b641",
  PAYMENT_LINK_297: "https://my.cfobydesign.com/payment-link/6a0db7ceee2395af2c17f5d0",
};

// How the agent assesses — Miguel Hernandez's actual diagnostic logic, grounded in the
// May 27, 2026 session transcript. Phrasing kept close to his own words on purpose.
const ASSESSMENT_RUBRIC = `You are a Senior Fractional CFO for CFO By Design, diagnosing a business from a SWOT intake.
Diagnose the way Miguel Hernandez does. The whole assessment is about one thing: the owner's
"ability to manage, or their ability to drown."

THE TWO CRITICAL NUMBERS (Miguel: "those two numbers together are critical and they're very basic"):
- Total corporate debt the business carries.
- Monthly debt service — what they pay every month servicing that debt.
Together these tell you whether cash flow can actually support the business.

THE MAGIC QUESTION (Miguel's term): does the owner make decisions based on their real numbers,
or on "what's in their bank account"? Most decide on bank balance without knowing net revenue —
that is the core financial blind spot, and it is a strong driver toward the paid diagnosis.

RED FLAGS THAT BLOCK FUNDING (push toward "rehab"):
- Active judgments, tax liens, or tax defaults — debt that is UNRESOLVED, not merely "being managed."
- Business tax returns for the last 2 years unfiled, or filed with an unresolved balance.

CASH-FLOW STRESS SIGNALS:
- Accounts receivable aging — 30 days is normal; 60+ days is when it becomes a problem.
- Corporate debt whose status is stretched or unmanaged (it is "status," never "relationship").
- No documented financial plan or budget; never had a financial audit or deep dive.

PATH SELECTION — choose exactly one:
- "rehab"  : active judgments / liens / tax defaults, OR unfiled-or-delinquent taxes. Stabilize the
             foundation before any growth strategy. The report becomes a resolution roadmap.
- "urgent" : no legal/tax blocker, but the financial blind spot plus stacked stress signals
             (stretched debt, heavy debt service, AR 60+, no budget). Real pressure — "critical exposure."
- "growth" : a functioning business with momentum but real, fixable gaps under the surface.
- "strong" : decisions made on real numbers, debt well-managed, taxes current, AR healthy.
             Here to optimize and scale ("untapped capacity"), not to fix.

OPPORTUNITY FLAGS - list ONLY flags backed by EXPLICIT evidence in their answers.
Do NOT infer flags from absence of data, generic financial pressure, or pattern-matching to
similar businesses. If an answer doesn't explicitly establish the trigger, leave the flag off.

- MERCHANT_PROCESSING_OPP: Fire ONLY if the business explicitly processes card or merchant
  payments (retail, restaurant, e-commerce, service business charging cards) AND the answers
  indicate the merchant cost/value/coverage has not been reviewed. Do NOT fire for B2B agencies,
  consultancies, or service businesses billing via subscription, invoice, ACH, or wire - they
  have no merchant exposure. "Vendor costs not reviewed" alone is NOT a trigger.

- DEBT_RESTRUCTURE_OPP: Fire ONLY when there is EXPLICIT, current, non-zero corporate debt
  AND the debt is described as heavy, stretched, unmanaged, or carrying high monthly debt
  service relative to revenue. Do NOT fire when the answer states $0 debt, "no debt," "no LOC,"
  or leaves debt unstated. Generic "revenue leaks," "cash pressure," or "tight margins" are
  NOT debt signals.

- TAX_RESOLUTION_OPP: Fire ONLY for explicitly unfiled tax returns, an outstanding tax balance,
  an active tax lien, or a stated tax payment plan. Do NOT fire when taxes are stated as
  filed and current.

- DIGITAL_PRESENCE_OPP: Fire when the business explicitly signals weak digital visibility
  (no/low reviews, no GBP, invisible in search/social, weak vs competitors) AND the business
  model depends on local discovery or online acquisition. Do NOT fire for businesses whose
  growth model is referral-only and explicitly so. NEVER fire on the FREE tier — digital
  presence findings are a paid-tier reveal and must be held back from the free report.`;

const TIER_GUIDE = {
  free: "FREE tier: concise and punchy. Surface the gaps and create urgency to upgrade, without solving everything. 3 gaps, 2 opportunities. DO NOT use digital presence / Google Business Profile / reviews / SEO as a gap or opportunity in the FREE report — that finding is reserved for the paid diagnostic. Focus the free tier on financial visibility, cash flow, decision-making, revenue concentration, and pipeline math.",
  paid_47: "$47 FULL DIAGNOSTIC: specific and prescriptive. Name exact gaps and what they cost. 3 gaps, 2 opportunities.",
  paid_297: "$297 DEEP DIVE: senior strategist brief. Deep, numbers-driven, references their narrative answers. 3 gaps, 2 opportunities.",
};

function buildPrompt(tier, answers, contact, businessProfile = {}) {
  const answerBlock = answers
    .map((a) => `- ${a.question}\n  Answer: ${a.answer}`)
    .join("\n");
  const guide = TIER_GUIDE[tier] || TIER_GUIDE.free;

  // Optional business profile (sent at $47 + $297 tiers from the GHL survey
  // business-info section). Only emit lines that have real values.
  const profileLines = [
    businessProfile.businessName && `Business: ${businessProfile.businessName}`,
    businessProfile.industry     && `Industry: ${businessProfile.industry}`,
    businessProfile.website      && `Website: ${businessProfile.website}`,
    [businessProfile.city, businessProfile.state, businessProfile.country]
      .filter(Boolean).join(", "),
  ].filter(Boolean);
  const profileBlock = profileLines.length
    ? `\nBUSINESS PROFILE:\n${profileLines.join("\n")}\n`
    : "";

  return `${ASSESSMENT_RUBRIC}

CLIENT: ${contact.name || "Business Owner"}${profileBlock}
TIER: ${tier}

THEIR ANSWERS:
${answerBlock}

TASK: Assess this business using the logic above. ${guide}
Every sentence must reference THEIR actual answers — no generic filler, no invented numbers.

Return ONLY valid JSON — no markdown code fences, no text before or after — in exactly this shape:
{
  "path": "rehab | urgent | growth | strong",
  "badge": "SHORT UPPERCASE LABEL",
  "headline": "one bold sentence naming their reality",
  "opener": "2-3 sentences describing their actual situation",
  "context": "one sentence of perspective",
  "gaps": [
    { "title": "short", "impact": "the concrete cost/consequence", "priority": "CRITICAL | HIGH | MEDIUM" }
  ],
  "opportunities": [
    { "title": "short", "desc": "one sentence", "impact": "short tag, e.g. Unlock $250K+" }
  ],
  "nextStepHeadline": "short",
  "nextStepBody": "2-3 sentences leading to a strategy call",
  "opportunityFlags": ["MERCHANT_PROCESSING_OPP"]
}`;
}

async function callClaude(prompt, env) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": CONFIG.ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Claude API ${response.status}: ${detail.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.content[0].text;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]
  ));
}

// Inline-styled HTML report body. Inline styles are essential for email clients
// (Gmail / Outlook / Apple Mail) which strip <style> blocks.
function buildReportHtml(agent) {
  const e = escapeHtml;
  const priColor = (p) =>
    p === "CRITICAL" ? "#b91c1c" :
    p === "HIGH" ? "#d97706" :
    "#92400e";

  const gapItem = (g) => `
    <tr><td style="padding:14px 16px;background:#fdf8f0;border-left:4px solid ${priColor(g.priority)};border-radius:4px;">
      <div style="font-family:Georgia,serif;font-weight:700;color:#1a1a1a;font-size:16px;">${e(g.title)}<span style="font-size:10px;font-weight:700;color:${priColor(g.priority)};letter-spacing:1.5px;margin-left:10px;">${e(g.priority)}</span></div>
      <div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:6px;line-height:1.55;">${e(g.impact)}</div>
    </td></tr><tr><td style="height:10px;"></td></tr>`;

  const oppItem = (o) => `
    <tr><td style="padding:14px 16px;background:#fdf8f0;border-left:4px solid #c4a647;border-radius:4px;">
      <div style="font-family:Georgia,serif;font-weight:700;color:#1a1a1a;font-size:16px;">${e(o.title)}</div>
      <div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:6px;line-height:1.55;">${e(o.desc)}</div>
      <div style="font-family:Arial,sans-serif;color:#92400e;font-weight:700;font-size:11px;margin-top:8px;letter-spacing:1.5px;text-transform:uppercase;">${e(o.impact)}</div>
    </td></tr><tr><td style="height:10px;"></td></tr>`;

  const gaps = (agent.gaps || []).map(gapItem).join("");
  const opps = (agent.opportunities || []).map(oppItem).join("");
  const context = agent.context
    ? `<p style="font-family:Georgia,serif;font-style:italic;color:#6b7280;font-size:15px;line-height:1.6;margin:12px 0 0;">${e(agent.context)}</p>`
    : "";

  return `
<div style="display:inline-block;padding:6px 14px;background:#fef3c7;color:#92400e;font-weight:700;font-size:11px;letter-spacing:2px;border-radius:999px;font-family:Arial,sans-serif;">${e(agent.badge)}</div>
<h1 style="font-family:Georgia,serif;font-size:26px;font-weight:700;margin:20px 0 16px;color:#1a1a1a;line-height:1.3;">${e(agent.headline)}</h1>
<p style="font-family:Georgia,serif;font-size:17px;color:#374151;line-height:1.65;margin:0;">${e(agent.opener)}</p>
${context}
<h2 style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#92400e;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin:32px 0 16px;">Critical Gaps Identified</h2>
<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;">${gaps}</table>
<h2 style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#92400e;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin:32px 0 16px;">Your Highest-Impact Opportunities</h2>
<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;">${opps}</table>
<h2 style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#1a1a1a;margin:32px 0 12px;">${e(agent.nextStepHeadline)}</h2>
<p style="font-family:Georgia,serif;font-size:16px;color:#374151;line-height:1.6;font-style:italic;margin:0;">${e(agent.nextStepBody)}</p>
`.trim();
}

// Tolerant JSON extraction — strips fences / preamble if the model adds any.
function parseAgentJson(text) {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Agent returned no JSON object");
  return JSON.parse(t.slice(start, end + 1));
}

// Accept answers as an array [{question, answer}] OR an object { "Q1": "..." }.
function normalizeAnswers(raw) {
  if (Array.isArray(raw)) {
    return raw
      .filter((a) => a && (a.answer !== undefined && a.answer !== ""))
      .map((a) => ({ question: String(a.question || a.id || "Question"), answer: String(a.answer) }));
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => ({ question: k, answer: String(v) }));
  }
  return [];
}

async function updateGHLContact(contactId, fields, env) {
  if (!contactId || !env.GHL_API_KEY) return false;
  const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
    },
    body: JSON.stringify({ customFields: fields }),
  });
  return res.ok;
}

// Find an existing contact by email in the configured location. Returns its id or null.
async function findGHLContactByEmail(email, env) {
  if (!email || !env.GHL_API_KEY) return null;
  const url = `${CONFIG.GHL_API_BASE}/contacts/search/duplicate?locationId=${(env.GHL_LOCATION_ID || CONFIG.GHL_LOCATION_ID)}&email=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
    },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data?.contact?.id || data?.id || null;
}

// Create a contact in the configured location. Returns the new id or null.
async function createGHLContact(contact, env) {
  if (!env.GHL_API_KEY) return null;
  const body = {
    locationId: (env.GHL_LOCATION_ID || CONFIG.GHL_LOCATION_ID),
    email: contact.email,
    firstName: (contact.name || "").split(" ")[0] || undefined,
    lastName: (contact.name || "").split(" ").slice(1).join(" ") || undefined,
    source: "SWOT Funnel",
  };
  const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data?.contact?.id || data?.id || null;
}

// Resolve a contactId: pass-through if given, otherwise find-by-email, otherwise create.
async function resolveGHLContactId(contact, env) {
  if (contact?.contactId) return contact.contactId;
  if (!contact?.email) return null;
  const existing = await findGHLContactByEmail(contact.email, env);
  if (existing) return existing;
  return await createGHLContact(contact, env);
}

async function addGHLTag(contactId, tags, env) {
  if (!contactId || !env.GHL_API_KEY || !tags.length) return false;
  const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/${contactId}/tags`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
    },
    body: JSON.stringify({ tags }),
  });
  return res.ok;
}

// Tag a paid tier requires before the front-end can show its survey.
// GHL workflows add these tags on "Payment Successful" so they cannot
// be added or spoofed by the front-end / URL params.
const TIER_REQUIRED_TAG = {
  paid_47:  "swot_paid_47",
  paid_297: "swot_paid_297",
};

// POST /upload — multipart/form-data with a "file" field.
// Forwards to GHL Media Library and returns the hosted URL.
// Optional form fields: contactId (for future per-contact organization).
// Returns: { success, url, fileId, fileName, size }
async function handleUpload(request, env) {
  if (!env.GHL_API_KEY) {
    return json({ success: false, error: "GHL not configured" }, 500);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ success: false, error: "Invalid multipart/form-data body" }, 400);
  }

  const file = formData.get("file");
  // In Workers, file-typed parts come back as File. String would mean no file part.
  if (!file || typeof file === "string") {
    return json({ success: false, error: "Missing 'file' field" }, 400);
  }

  // Conservative size limit — covers P&L PDFs, blocks accidental huge uploads.
  const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
  if (file.size > MAX_BYTES) {
    return json({ success: false, error: "File too large (max 25 MB)" }, 413);
  }

  // Forward to GHL Media Library.
  const ghlForm = new FormData();
  ghlForm.append("file", file, file.name || "upload");
  ghlForm.append("locationId", (env.GHL_LOCATION_ID || CONFIG.GHL_LOCATION_ID));
  ghlForm.append("hosted", "false");

  const res = await fetch(`${CONFIG.GHL_API_BASE}/medias/upload-file`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
      // Don't set Content-Type — fetch sets it (with the multipart boundary) automatically.
    },
    body: ghlForm,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return json(
      { success: false, error: `GHL upload failed (${res.status})`, detail: detail.slice(0, 300) },
      502
    );
  }

  const data = await res.json().catch(() => ({}));
  return json({
    success: true,
    fileId:   data.fileId   || data.id      || null,
    url:      data.url      || data.fileUrl || data.path || null,
    fileName: file.name || "file",
    size:     file.size,
  });
}

// POST /verify — confirm a contact has paid for a tier.
// Body: { contactId, tier }
// Returns: { verified: boolean, contact: {contactId, name, email} | null }
async function handleVerify(body, env) {
  const contactId = body?.contactId;
  const tier = body?.tier;
  if (!contactId || !tier) {
    return json({ verified: false, error: "Missing contactId or tier" }, 400);
  }
  const requiredTag = TIER_REQUIRED_TAG[tier];
  if (!requiredTag) {
    return json({ verified: false, error: `Tier "${tier}" does not require verification` }, 400);
  }
  if (!env.GHL_API_KEY) {
    return json({ verified: false, error: "GHL not configured" }, 500);
  }

  const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/${contactId}`, {
    headers: {
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
    },
  });
  if (!res.ok) {
    return json({ verified: false, error: "Contact not found" }, 404);
  }
  const data = await res.json().catch(() => ({}));
  const c = data?.contact || {};
  const tags = (c.tags || []).map((t) => String(t).toLowerCase());
  const verified = tags.includes(requiredTag.toLowerCase());

  return json({
    verified,
    contact: verified
      ? {
          contactId,
          name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" "),
          email: c.email || "",
        }
      : null,
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    if (request.method !== "POST") return json({ success: false, error: "POST only" }, 405);

    // Route /upload BEFORE JSON parsing — it expects multipart/form-data.
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    if (path === "/upload") {
      return handleUpload(request, env);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ success: false, error: "Invalid JSON body" }, 400);
    }

    // /verify uses JSON like the main assessment endpoint.
    if (path === "/verify") {
      return handleVerify(body, env);
    }

    const tier = body.tier || "free";
    const contact = body.contact || body.contactData || {};
    const businessProfile = body.businessProfile || {};
    const answers = normalizeAnswers(body.answers);
    if (!answers.length) return json({ success: false, error: "No answers provided" }, 400);

    let agent;
    try {
      const raw = await callClaude(
        buildPrompt(tier, answers, contact, businessProfile),
        env
      );
      agent = parseAgentJson(raw);
    } catch (err) {
      console.error("Assessment error:", err.message);
      return json({ success: false, error: err.message }, 500);
    }

    // Defensive gate: digital presence is a paid-tier reveal. Strip from FREE output
    // even if the agent misfires, and scrub any digital-presence opportunity from
    // the free report body so it isn't given away in the teaser.
    if (tier === "free") {
      agent.opportunityFlags = (agent.opportunityFlags || []).filter(
        (f) => f !== "DIGITAL_PRESENCE_OPP"
      );
      const looksDigital = (s) => {
        const t = String(s || "").toLowerCase();
        return /google business profile|gbp\b|\bseo\b|online review|low reviews|few reviews|digital presence|search visibility|social presence/.test(t);
      };
      if (Array.isArray(agent.opportunities)) {
        agent.opportunities = agent.opportunities.filter(
          (o) => !looksDigital(o && (o.title + " " + o.desc))
        );
      }
      if (Array.isArray(agent.gaps)) {
        agent.gaps = agent.gaps.filter(
          (g) => !looksDigital(g && (g.title + " " + g.impact))
        );
      }
    }

    // Resolve a GHL contactId from email if one wasn't passed in.
    const contactId = await resolveGHLContactId(contact, env);

    // Best-effort GHL writeback to CFO By Design's real SWOT custom fields.
    if (contactId) {
      const reportBody = buildReportHtml(agent);

      // One report field per tier — no mirroring. Each tier has its own named deliverable:
      //   free     -> swot_free_report      (Free SWOT Report)
      //   paid_47  -> swot_full_report      (Full Diagnostic Report)
      //   paid_297 -> business_playbook     (Business Playbook — the $297 deliverable)
      const reportFieldKey =
        tier === "paid_297" ? "business_playbook"
        : tier === "paid_47" ? "swot_full_report"
        : "swot_free_report";

      const fields = [
        { key: "swot_path", field_value: String(agent.path || "") },
        { key: "swot_rehab_flag", field_value: agent.path === "rehab" ? "true" : "false" },
        { key: reportFieldKey, field_value: reportBody },
      ];
      if (tier === "paid_297") {
        fields.push({ key: "swot_deep_dive_booked", field_value: "true" });
      }

      // Tag pattern matches the workflows you build in GHL:
      //   SWOT_FREE_LEAD / SWOT_PAID_47 / SWOT_PAID_297, plus opportunity flags.
      const tierTag =
        tier === "paid_297" ? "SWOT_PAID_297"
        : tier === "paid_47" ? "SWOT_PAID_47"
        : "SWOT_FREE_LEAD";
      const tags = [tierTag, `SWOT_PATH_${(agent.path || "").toUpperCase()}`, ...(agent.opportunityFlags || [])].filter(Boolean);

      ctx.waitUntil(
        Promise.allSettled([
          updateGHLContact(contactId, fields, env),
          addGHLTag(contactId, tags, env),
        ])
      );
    }

    const bookingLink =
      tier === "paid_297" ? (env.BOOKING_LINK_297 || CONFIG.BOOKING_LINK_297)
      : tier === "paid_47" ? (env.BOOKING_LINK_47 || CONFIG.BOOKING_LINK_47)
      : null;

    return json({ success: true, tier, ...agent, bookingLink });
  },
};
