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
  BOOKING_LINK_47: "YOUR_30MIN_CALENDAR_LINK",
  BOOKING_LINK_297: "YOUR_50MIN_CALENDAR_LINK",
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

    // Best-effort GHL writeback to CFO By Design's real SWOT custom fields.
    if (contact.contactId) {
      const reportBody = [
        `# ${agent.badge || ""}`,
        `## ${agent.headline || ""}`,
        agent.opener || "",
        agent.context ? `_${agent.context}_` : "",
        "",
        "## Critical Gaps",
        ...(agent.gaps || []).map(g => `- **${g.title}** (${g.priority}) ‚Äî ${g.impact}`),
        "",
        "## Opportunities",
        ...(agent.opportunities || []).map(o => `- **${o.title}** ‚Äî ${o.desc} _(${o.impact})_`),
        "",
        `## ${agent.nextStepHeadline || ""}`,
        agent.nextStepBody || "",
      ].join("\n");

      // Tier picks the destination field ‚Äî the keys exist already in GHL.
      const reportFieldKey =
        tier === "paid_297" ? "swot_strategist_brief"
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

      const tags = [`SWOT_${tier.toUpperCase()}`, ...(agent.opportunityFlags || [])];
      ctx.waitUntil(
        Promise.allSettled([
          updateGHLContact(contact.contactId, fields, env),
          addGHLTag(contact.contactId, tags, env),
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
