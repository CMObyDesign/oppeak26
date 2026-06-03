/**
 * CFO By Design ‚Äî SWOT Engine Worker v3
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

// How the agent assesses ‚Äî Miguel Hernandez's actual diagnostic logic, grounded in the
// May 27, 2026 session transcript. Phrasing kept close to his own words on purpose.
const ASSESSMENT_RUBRIC = `You are a Senior Fractional CFO for CFO By Design, diagnosing a business from a SWOT intake.
Diagnose the way Miguel Hernandez does. The whole assessment is about one thing: the owner's
"ability to manage, or their ability to drown."

THE TWO CRITICAL NUMBERS (Miguel: "those two numbers together are critical and they're very basic"):
- Total corporate debt the business carries.
- Monthly debt service ‚Äî what they pay every month servicing that debt.
Together these tell you whether cash flow can actually support the business.

THE MAGIC QUESTION (Miguel's term): does the owner make decisions based on their real numbers,
or on "what's in their bank account"? Most decide on bank balance without knowing net revenue ‚Äî
that is the core financial blind spot, and it is a strong driver toward the paid diagnosis.

RED FLAGS THAT BLOCK FUNDING (push toward "rehab"):
- Active judgments, tax liens, or tax defaults ‚Äî debt that is UNRESOLVED, not merely "being managed."
- Business tax returns for the last 2 years unfiled, or filed with an unresolved balance.

CASH-FLOW STRESS SIGNALS:
- Accounts receivable aging ‚Äî 30 days is normal; 60+ days is when it becomes a problem.
- Corporate debt whose status is stretched or unmanaged (it is "status," never "relationship").
- No documented financial plan or budget; never had a financial audit or deep dive.

PATH SELECTION ‚Äî choose exactly one:
- "rehab"  : active judgments / liens / tax defaults, OR unfiled-or-delinquent taxes. Stabilize the
             foundation before any growth strategy. The report becomes a resolution roadmap.
- "urgent" : no legal/tax blocker, but the financial blind spot plus stacked stress signals
             (stretched debt, heavy debt service, AR 60+, no budget). Real pressure ‚Äî "critical exposure."
- "growth" : a functioning business with momentum but real, fixable gaps under the surface.
- "strong" : decisions made on real numbers, debt well-managed, taxes current, AR healthy.
             Here to optimize and scale ("untapped capacity"), not to fix.

OPPORTUNITY FLAGS ‚Äî list any that apply (these are services CFO By Design / Spark can sell):
- Merchant processing never reviewed, or unknown cost / value / coverage -> "MERCHANT_PROCESSING_OPP"
- Heavy or stretched corporate debt -> "DEBT_RESTRUCTURE_OPP"
- Unfiled taxes or an outstanding balance -> "TAX_RESOLUTION_OPP"
- Weak digital presence vs competitors (reviews, local visibility), or a local / e-commerce model
  that depends on it -> "DIGITAL_PRESENCE_OPP"`;

const TIER_GUIDE = {
  free: "FREE tier: concise and punchy. Surface the gaps and create urgency to upgrade, without solving everything. 3 gaps, 2 opportunities.",
  paid_47: "$47 FULL DIAGNOSTIC: specific and prescriptive. Name exact gaps and what they cost. 3 gaps, 2 opportunities.",
  paid_297: "$297 DEEP DIVE: senior strategist brief. Deep, numbers-driven, references their narrative answers. 3 gaps, 2 opportunities.",
};

function buildPrompt(tier, answers, contact) {
  const answerBlock = answers
    .map((a) => `- ${a.question}\n  Answer: ${a.answer}`)
    .join("\n");
  const guide = TIER_GUIDE[tier] || TIER_GUIDE.free;

  return `${ASSESSMENT_RUBRIC}

CLIENT: ${contact.name || "Business Owner"}
TIER: ${tier}

THEIR ANSWERS:
${answerBlock}

TASK: Assess this business using the logic above. ${guide}
Every sentence must reference THEIR actual answers ‚Äî no generic filler, no invented numbers.

Return ONLY valid JSON ‚Äî no markdown code fences, no text before or after ‚Äî in exactly this shape:
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

// Tolerant JSON extraction ‚Äî strips fences / preamble if the model adds any.
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
  const url = `${CONFIG.GHL_API_BASE}/contacts/search/duplicate?locationId=${CONFIG.GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`;
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
    locationId: CONFIG.GHL_LOCATION_ID,
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

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ success: false, error: "Invalid JSON body" }, 400);
    }

    const tier = body.tier || "free";
    const contact = body.contact || body.contactData || {};
    const answers = normalizeAnswers(body.answers);
    if (!answers.length) return json({ success: false, error: "No answers provided" }, 400);

    let agent;
    try {
      const raw = await callClaude(buildPrompt(tier, answers, contact), env);
      agent = parseAgentJson(raw);
    } catch (err) {
      console.error("Assessment error:", err.message);
      return json({ success: false, error: err.message }, 500);
    }

    // Resolve a GHL contactId from email if one wasn't passed in.
    const contactId = await resolveGHLContactId(contact, env);

    // Best-effort GHL writeback to CFO By Design's real SWOT custom fields.
    if (contactId) {
      const reportBody = buildReportHtml(agent);

      // One report field per tier ‚Äî no mirroring. Each tier has its own named deliverable:
      //   free     ‚Üí swot_free_report      (Free SWOT Report)
      //   paid_47  ‚Üí swot_full_report      (Full Diagnostic Report)
      //   paid_297 ‚Üí business_playbook     (Business Playbook ‚Äî the $297 deliverable)
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
      tier === "paid_297" ? CONFIG.BOOKING_LINK_297
      : tier === "paid_47" ? CONFIG.BOOKING_LINK_47
      : null;

    return json({ success: true, tier, ...agent, bookingLink });
  },
};
