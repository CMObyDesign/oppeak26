/**
 * CFO By Design — SWOT Engine Worker v2
 * Cloudflare Worker — three-tier funnel orchestration
 *
 * Data flow:
 * GHL webhook → tier determination → score calculation →
 * prompt selection → Claude API → report generation →
 * GHL custom field update → Zoho CRM sync
 *
 * Tiers:
 *   free     → free_tier_prompt    → on-screen results + email
 *   paid_47  → paid_tier_prompt    → PDF report + 30-min booking
 *   paid_297 → strategist_brief    → 50-min session + brief
 *
 * Environment variables (set in Cloudflare dashboard):
 *   ANTHROPIC_API_KEY
 *   GHL_API_KEY
 *   ZOHO_API_KEY
 */

const CONFIG = {
  GHL_LOCATION_ID: "oLIENQCtGnt9U6gfLhE5",
  PAYMENT_LINK_47: "https://my.cfobydesign.com/payment-link/6a0db7aa1a6dcdeebb53b641",
  PAYMENT_LINK_297: "https://my.cfobydesign.com/payment-link/6a0db7ceee2395af2c17f5d0",
  BOOKING_LINK_47: "YOUR_30MIN_CALENDAR_LINK",
  BOOKING_LINK_297: "YOUR_50MIN_CALENDAR_LINK",
  CLAUDE_MODEL: "claude-sonnet-4-20250514",
  GHL_API_BASE: "https://services.leadconnectorhq.com",
};

const PATH_THRESHOLDS = {
  free_tier: {
    CRITICAL_EXPOSURE: { min: 5, max: 12 },
    HIDDEN_LIABILITY: { min: 13, max: 18 },
    UNTAPPED_CAPACITY: { min: 19, max: 25 },
  },
  full_assessment: {
    CRITICAL_EXPOSURE: { min: 14, max: 28 },
    HIDDEN_LIABILITY: { min: 29, max: 41 },
    UNTAPPED_CAPACITY: { min: 42, max: 54 },
  },
};

function calculateScore(answers) {
  let total = 0;
  const categoryScores = {};
  let rehabTriggered = false;
  const contextData = {};
  const contextOnly = ["Q9", "Q13"];
  const aiAnchor = "Q14";

  if (parseInt(answers["Q11"]) === 1) {
    rehabTriggered = true;
  }

  for (const [qId, value] of Object.entries(answers)) {
    if (contextOnly.includes(qId)) {
      contextData[qId] = value;
      continue;
    }
    if (qId === aiAnchor) {
      contextData[qId] = value;
      continue;
    }
    const points = parseInt(value) || 0;
    total += points;
    categoryScores[qId] = points;
  }

  const hasPaidAnswers = Object.keys(answers).some(
    k => parseInt(k.replace("Q", "")) >= 6
  );
  const tier = hasPaidAnswers ? "full_assessment" : "free_tier";

  let path;
  if (rehabTriggered) {
    path = "REHAB_REQUIRED";
  } else {
    const thresholds = PATH_THRESHOLDS[tier];
    if (total <= thresholds.CRITICAL_EXPOSURE.max) {
      path = "CRITICAL_EXPOSURE";
    } else if (total <= thresholds.HIDDEN_LIABILITY.max) {
      path = "HIDDEN_LIABILITY";
    } else {
      path = "UNTAPPED_CAPACITY";
    }
  }

  return { total, categoryScores, path, rehabTriggered, tier, contextData };
}

function buildFreePrompt(answers, scoreResult, contactData) {
  const stageLabels = {
    "1": "Early stage — revenue is inconsistent",
    "2": "Growing — money coming in but margins feel thin",
    "3": "Scaling — revenue is real but structure isn't keeping up",
    "5": "Established — $2M+, efficiency is the challenge",
  };
  const accountingLabels = {
    "1": "doing it myself in spreadsheets",
    "2": "using basic accounting software",
    "3": "part-time bookkeeper",
    "4": "full-time bookkeeper or accountant",
    "5": "CPA with monthly reviews",
  };
  const breakEvenLabels = {
    "1": "No — never calculated it",
    "2": "Rough idea but never done the actual math",
    "3": "Calculated before but don't actively track",
    "4": "Yes — know it and check occasionally",
    "5": "Yes — use it to make decisions every month",
  };

  return `You are a Senior Fractional CFO for high-growth businesses.
Your tone is professional, direct, and diagnostic. No fluff. No generic language.
Every sentence must reference this specific client's answers.

Client: ${contactData.firstName || "Business Owner"}
Revenue stage: ${stageLabels[answers.Q1] || answers.Q1}
Accounting: ${accountingLabels[answers.Q2] || answers.Q2}
Break-even awareness: ${breakEvenLabels[answers.Q3] || answers.Q3}
Reporting confidence: ${answers.Q4}/5
Business maturity: ${answers.Q5}/5

Diagnostic path: ${scoreResult.path}
Free score: ${scoreResult.total} out of 25

Generate a financial pulse check report in clean Markdown.
Follow this exact structure:

**Your path: ${scoreResult.path}**
Score: ${scoreResult.total} out of 25

[One paragraph interpreting the specific relationship between 
their accounting answer and break-even awareness. Name the 
exact risk this combination creates for a business at their 
stage. No generic language.]

**What this means for your funding access**
[2-3 sentences. Specific to their revenue stage and 
reporting confidence score. Name what lenders see.]

**What this assessment did not cover**
[Name the 5 categories not yet assessed: funding readiness, 
credit position, cash flow management, debt obligations, 
advisory support. State that lenders evaluate all 5. 
One sentence each. Create urgency without exaggeration.]

**Your next step**
[One CTA sentence pointing to the $47 Full Diagnostic 
+ 30-minute Strategy Session.]

Max 350 words. Prose only in main narrative — no bullet lists.`;
}

function buildPaid47Prompt(answers, scoreResult, contactData, businessProfile) {
  const q14 = scoreResult.contextData["Q14"] || "";
  const q13 = scoreResult.contextData["Q13"] || "";
  const q9 = scoreResult.contextData["Q9"] || "";

  const industryInsights = {
    "Professional services — consulting, coaching, or agency":
      "Coaches and consultants at your revenue stage who access $100K+ credit lines share one thing — documented break-even and monthly P&L review.",
    "Construction, trades, or home services":
      "Construction businesses at your revenue stage typically need equipment financing and tax resolution before growth capital. Lenders look at project revenue consistency and tax compliance first.",
    "Real estate or mortgage / lending":
      "Mortgage and lending professionals face personal credit scrutiny above almost any other industry. Your personal credit score directly determines what business products you can access.",
    "Credit repair or financial coaching":
      "Financial coaches who can demonstrate their own financial structure to clients close more high-ticket engagements. Your credibility is directly tied to your financial health.",
    "Nonprofit or community organization":
      "Nonprofits with earned revenue arms qualify for business funding products most assume are unavailable. The key is separating operational revenue from donation income in your financials.",
  };

  const competitorInsight = industryInsights[q9] ||
    "Businesses in your industry that access growth capital consistently share one trait — organized financials they can present on demand.";

  return `You are a Senior Fractional CFO for high-growth businesses.
Tone: professional, direct, diagnostic. No fluff.
Every sentence must reference this client's actual answers.

CLIENT PROFILE:
Name: ${contactData.firstName || "Business Owner"}
Business: ${businessProfile.businessName || "not provided"}
Website: ${businessProfile.website || "not provided"}
Market: ${businessProfile.city || "not provided"}
Industry: ${q9 || "not specified"}
Path: ${scoreResult.path}
Full score: ${scoreResult.total}/54
Rehab triggered: ${scoreResult.rehabTriggered}

ALL ANSWERS:
Q1 Revenue stage: ${answers.Q1}
Q2 Accounting: ${answers.Q2}
Q3 Break-even: ${answers.Q3}
Q4 Reporting confidence: ${answers.Q4}
Q5 Business maturity: ${answers.Q5}
Q6 Funding history: ${answers.Q6}
Q7 Credit profile: ${answers.Q7}
Q8 Geographic scope: ${answers.Q8}
Q10 Cash flow: ${answers.Q10}
Q11 Debt/obligations: ${answers.Q11}
Q12 Advisory support: ${answers.Q12}
Q13 12-month goal: ${q13}
Q14 Stated challenge: ${q14}

Generate a full diagnostic report in clean Markdown for PDF export.

${q14
  ? `OPENING: Lead with "${q14}" — validate this challenge in 2-3 sentences and link it directly to their quantitative scores.`
  : "OPENING: Lead with their single lowest-scoring category and what it signals."
}

SECTION 1 — YOUR FINANCIAL HEALTH PATH
State path name and score. 2-3 sentences on what this path 
means at their specific revenue stage. Concrete — not abstract.

SECTION 2 — WHAT YOUR SCORES ARE TELLING US
Prose. Walk through the 4-5 most significant categories.
Name the most critical interplay pair for this client specifically.
Apply cascade logic where relevant.

SECTION 3 — YOUR SINGLE MOST URGENT GAP
One gap only. What it is. What it costs them right now.
What it is blocking — tie to their Q13 goal directly.

SECTION 4 — WHAT YOUR COMPETITORS ARE DOING DIFFERENTLY
${scoreResult.rehabTriggered
  ? "REHAB PATH: Replace this section with resolution roadmap — what happens in months 1-3, 4-6, and 7-12 if they address the active matter now."
  : `2-3 insights. Use this industry context: ${competitorInsight}`
}

SECTION 5 — TWO SERVICE BUNDLES
Two specific CFO By Design bundles tied to their top two gaps.
Name what each bundle does in 30 days and 90 days.

SECTION 6 — YOUR 30-MINUTE STRATEGY SESSION
3-4 sentences. Reference their Q13 goal by name.
State what will happen on the call — specific, not vague.
End with: Book your session → ${CONFIG.BOOKING_LINK_47}

SECTION 7 — WHAT A SENIOR STRATEGIST SEES THAT THIS REPORT CANNOT
Lead with one observation requiring deeper analysis than a 
scored assessment can provide. Include the note from senior team.
Reference their path and lowest two scores specifically.
End with: Ready for the full analysis? → ${CONFIG.PAYMENT_LINK_297}

Constraints: Max 650 words. Prose-driven. No generic language.`;
}

function buildDeepDivePrompt(answers, scoreResult, deepDiveAnswers, contactData) {
  const q14 = scoreResult.contextData["Q14"] || "";
  const qJ = deepDiveAnswers["Q_J"] || "";
  const qH = deepDiveAnswers["Q_H"] || "";
  const qI = deepDiveAnswers["Q_I"] || "";

  const vendorFlag = parseInt(qH) <= 2 && parseInt(qH) > 0;
  const taxFlag = parseInt(qI) >= 3;

  return `You are the CFO By Design Senior Strategist Intelligence System.
Generate an internal prep brief for a human senior strategist.
Direct, blunt, internal document. Bullet points fine throughout.

${scoreResult.rehabTriggered ? "⚑ REHAB FLAG ACTIVE — open Section 4 with this. Tax or legal matter must be resolved first." : ""}
${taxFlag ? "⚑ TAX SITUATION FLAG — client has outstanding tax matter. Position Tax Resolution as prerequisite." : ""}
${vendorFlag ? "★ VENDOR OPPORTUNITY — client has not reviewed merchant processing, payroll, or insurance costs. Mention before call closes." : ""}

CLIENT:
Name: ${contactData.firstName || ""} ${contactData.lastName || ""}
Path: ${scoreResult.path}
Score: ${scoreResult.total}/54
Rehab triggered: ${scoreResult.rehabTriggered}

ASSESSMENT ANSWERS:
Q1-Q5: ${JSON.stringify({Q1:answers.Q1,Q2:answers.Q2,Q3:answers.Q3,Q4:answers.Q4,Q5:answers.Q5})}
Q6-Q12: ${JSON.stringify({Q6:answers.Q6,Q7:answers.Q7,Q8:answers.Q8,Q10:answers.Q10,Q11:answers.Q11,Q12:answers.Q12})}
Q13 goal: ${scoreResult.contextData["Q13"] || ""}
Q14 challenge: ${q14}

DEEP DIVE CONTEXT:
Q_A Team size: ${deepDiveAnswers.Q_A || ""}
Q_B Revenue mix: ${deepDiveAnswers.Q_B || ""}
Q_C Budget/plan: ${deepDiveAnswers.Q_C || ""}
Q_D Pricing model: ${deepDiveAnswers.Q_D || ""}
Q_E Accounts receivable: ${deepDiveAnswers.Q_E || ""}
Q_F Audit history: ${deepDiveAnswers.Q_F || ""}
Q_G Debt relationship: ${deepDiveAnswers.Q_G || ""}
Q_H Vendor cost review: ${qH}
Q_I Tax situation: ${qI}
Q_J 3-year vision: ${qJ}

Generate the full strategist brief:

SECTION 1 — CLIENT SNAPSHOT
One prose paragraph. Brief a colleague in 30 seconds.

SECTION 2 — THE GAP
Q_J vision vs Q14 obstacle. One direct sentence naming the gap.
3-4 sentences on why current structure makes that vision hard.

SECTION 3 — THREE FINANCIAL POTHOLES
For each: name it, what the data shows, why it matters,
what breaks first, earliest warning signal.
Apply cascade logic. Be specific to their answers.

SECTION 4 — PRE-MORTEM
4-6 sentence scenario. What happens in 12 months if nothing changes.
Specific to their answers. Not generic.
${scoreResult.rehabTriggered ? "Open with the active matter — what happens if unresolved before growth." : ""}

SECTION 5 — CALL BATTLE PLAN
Phase 1 (0-10 min): 2-3 specific openers
Phase 2 (10-35 min): sequenced analysis walkthrough
Phase 3 (35-50 min): quick wins (30 days), medium bets (90 days),
long game (6-12 months), close toward CFO retainer
${vendorFlag ? "Include vendor cost review talking point before close." : ""}

SECTION 6 — BRIDGE TO ONGOING ENGAGEMENT
2-3 talking points using Q_J vision and biggest pothole.

SECTION 7 — WATCH FLAGS
Any sensitivity flags. ${taxFlag ? "TAX RESOLUTION: position carefully — prerequisite, not obstacle." : ""}
${vendorFlag ? "VENDOR OPPORTUNITY: merchant processing, payroll, insurance savings conversation." : ""}

Max 600 words. Scannable in 5 minutes.
END: PATH: ${scoreResult.path} | SCORE: ${scoreResult.total}/54`;
}

async function callClaude(prompt, env) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }
  const data = await response.json();
  return data.content[0].text;
}

async function updateGHLContact(contactId, fields, env) {
  if (!contactId || !env.GHL_API_KEY) return false;
  const response = await fetch(
    `${CONFIG.GHL_API_BASE}/contacts/${contactId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GHL_API_KEY}`,
        Version: "2021-07-28",
      },
      body: JSON.stringify({ customFields: fields }),
    }
  );
  return response.ok;
}

async function addGHLTag(contactId, tags, env) {
  if (!contactId || !env.GHL_API_KEY) return false;
  const response = await fetch(
    `${CONFIG.GHL_API_BASE}/contacts/${contactId}/tags`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GHL_API_KEY}`,
        Version: "2021-07-28",
      },
      body: JSON.stringify({ tags }),
    }
  );
  return response.ok;
}

async function syncZohoCRM(contactData, scoreResult, env) {
  // Wire after GHL flow confirmed working
  console.log("Zoho sync pending implementation");
  return true;
}

function determineTier(body) {
  if (body.tier) return body.tier;
  const answers = body.answers || {};
  const hasDeepDive = body.deepDiveAnswers &&
    Object.keys(body.deepDiveAnswers).length > 0;
  const hasPaid = Object.keys(answers).some(
    k => parseInt(k.replace("Q", "")) >= 6
  );
  if (hasDeepDive) return "paid_297";
  if (hasPaid) return "paid_47";
  return "free";
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const {
      answers = {},
      deepDiveAnswers = {},
      contactData = {},
      businessProfile = {},
    } = body;

    const tier = determineTier(body);
    const scoreResult = calculateScore(answers);

    let prompt;
    let claudeOutput;
    let ghlFields = [];
    let tags = [];

    try {
      if (tier === "free") {
        prompt = buildFreePrompt(answers, scoreResult, contactData);
        claudeOutput = await callClaude(prompt, env);
        ghlFields = [
          { key: "swot_path", field_value: scoreResult.path },
          { key: "swot_score", field_value: String(scoreResult.total) },
          { key: "swot_free_report", field_value: claudeOutput },
        ];
        tags = ["SWOT_FREE_LEAD"];
      }

      else if (tier === "paid_47") {
        prompt = buildPaid47Prompt(
          answers, scoreResult, contactData, businessProfile
        );
        claudeOutput = await callClaude(prompt, env);
        ghlFields = [
          { key: "swot_paid_path", field_value: scoreResult.path },
          { key: "swot_paid_score", field_value: String(scoreResult.total) },
          { key: "swot_full_report", field_value: claudeOutput },
          { key: "swot_rehab_flag",
            field_value: String(scoreResult.rehabTriggered) },
        ];
        tags = ["SWOT_PAID_LEAD"];
      }

      else if (tier === "paid_297") {
        prompt = buildDeepDivePrompt(
          answers, scoreResult, deepDiveAnswers, contactData
        );
        claudeOutput = await callClaude(prompt, env);

        const vendorVal = parseInt(deepDiveAnswers.Q_H) || 0;
        const taxVal = parseInt(deepDiveAnswers.Q_I) || 0;
        if (vendorVal > 0 && vendorVal <= 2) tags.push("VENDOR_OPPORTUNITY");
        if (taxVal >= 3) tags.push("TAX_RESOLUTION_OPPORTUNITY");

        ghlFields = [
          { key: "swot_297_path", field_value: scoreResult.path },
          { key: "swot_297_score", field_value: String(scoreResult.total) },
          { key: "swot_strategist_brief", field_value: claudeOutput },
          { key: "swot_deep_dive_booked", field_value: "true" },
          { key: "swot_vendor_review",
            field_value: deepDiveAnswers.Q_H || "" },
          { key: "swot_tax_situation",
            field_value: deepDiveAnswers.Q_I || "" },
        ];
        tags.push("SWOT_DEEP_DIVE_BOOKED");
      }

      if (contactData.contactId) {
        await updateGHLContact(contactData.contactId, ghlFields, env);
        await addGHLTag(contactData.contactId, tags, env);
        ctx.waitUntil(
          syncZohoCRM(contactData, scoreResult, env)
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          tier,
          path: scoreResult.path,
          score: scoreResult.total,
          rehabTriggered: scoreResult.rehabTriggered,
          report: claudeOutput,
          bookingLink:
            tier === "paid_47" ? CONFIG.BOOKING_LINK_47
            : tier === "paid_297" ? CONFIG.BOOKING_LINK_297
            : null,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(),
          },
        }
      );
    } catch (err) {
      console.error("Worker error:", err.message);
      return new Response(
        JSON.stringify({ success: false, error: err.message }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(),
          },
        }
      );
    }
  },
};
