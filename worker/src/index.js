/**
 * CFO By Design — SWOT Engine Worker v3
 * Agent-assessed funnel.
 *
 * Flow: form answers -> Claude assesses (Miguel's logic) + writes the report
 *       -> structured JSON that the front-end renders directly.
 *       -> async GHL writeback (tier-specific report field, blurb, strategist brief, hosted URL)
 *
 * The worker is QUESTION-AGNOSTIC: it accepts whatever labeled question/answer
 * pairs the form sends, so it works with the current questions and with v3.
 *
 * Endpoints:
 *   POST /                  — main assessment
 *   POST /upload            — multipart file upload to GHL Media Library
 *   POST /verify            — confirm a contact has paid for a tier
 *   GET  /report/{id}       — serve a contact's stored report as a styled standalone HTML page
 *   GET  /asksolomon        — internal training & testing console (password-protected)
 *   POST /asksolomon/run    — execute a test run without GHL writeback (password-protected)
 *   GET  /asksolomon/rubric — return the current ASSESSMENT_RUBRIC (password-protected)
 *
 * Runtime secrets (set in Cloudflare dashboard): ANTHROPIC_API_KEY, GHL_API_KEY, CONSOLE_PASSWORD
 */
import { CONSOLE_PAGE } from "./console_page.js";

const CONFIG = {
  CLAUDE_MODEL: "claude-sonnet-4-6",
  ANTHROPIC_VERSION: "2023-06-01",
  GHL_API_BASE: "https://services.leadconnectorhq.com",
  GHL_LOCATION_ID: "oLIENQCtGnt9U6gfLhE5",
  BOOKING_LINK_47: "https://my.cfobydesign.com/widget/booking/D3yNZNFtqIYsChkOgQc9",
  BOOKING_LINK_297: "https://my.cfobydesign.com/widget/booking/VGdN6KoFBtbdnSvHKHTh",
  PAYMENT_LINK_47: "https://my.cfobydesign.com/payment-link/6a0db7aa1a6dcdeebb53b641",
  PAYMENT_LINK_297: "https://my.cfobydesign.com/payment-link/6a0db7ceee2395af2c17f5d0",
  // HL Inbound Webhook (Workflow trigger) for tracking events. Worker POSTs completed
  // report events here so an HL workflow can log answers to a Sheet, notify Slack,
  // apply tasks, etc. Override via env.HL_TRACKING_WEBHOOK if the URL changes.
  HL_TRACKING_WEBHOOK: "https://services.leadconnectorhq.com/hooks/oLIENQCtGnt9U6gfLhE5/webhook-trigger/ee6a470e-afe5-40b6-a789-e7802cd1a86c",
  // GHL custom field IDs — used by the /report endpoint to look up stored report content.
  // The GHL v2 contact GET endpoint returns customFields keyed by `id`, NOT `fieldKey`,
  // so we must match on the ID. These are the field IDs for location oLIENQCtGnt9U6gfLhE5.
  REPORT_FIELD_IDS: {
    swot_free_report: "Ys28pMUc82cURfnsbQzY",
    swot_full_report: "pa6VF4GsufGuTAjlFVnf",
    business_playbook: "XEuWL4vobueOpZGBFdLm",
  },
};

// How the agent assesses — Miguel Hernandez's actual diagnostic logic, grounded in the
// May 27, 2026 session transcript. Phrasing kept close to his own words on purpose.
// Sent in Anthropic's `system` block with cache_control so it hits prompt cache on
// repeat runs within a 5-minute window (~90% input-token cost savings on cache hits).
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

  // NOTE: ASSESSMENT_RUBRIC is sent in the Anthropic `system` block (with cache_control),
  // NOT inlined here. Keep this user-message dynamic-only so cache hits land.
  return `CLIENT: ${contact.name || "Business Owner"}${profileBlock}
TIER: ${tier}

THEIR ANSWERS:
${answerBlock}

TASK: Assess this business using the methodology in your system instructions. ${guide}
Every sentence must reference THEIR actual answers — no generic filler, no invented numbers.

Return ONLY valid JSON — no markdown code fences, no text before or after — in exactly this shape:
{
  "path": "rehab | urgent | growth | strong",
  "badge": "SHORT UPPERCASE LABEL",
  "headline": "one bold sentence naming their reality",
  "opener": "2-3 sentences describing their actual situation (this is the personalized hook used in their delivery email — write it so it could stand alone as the first paragraph of a message TO them)",
  "context": "one sentence of perspective",
  "gaps": [
    { "title": "short", "impact": "the concrete cost/consequence", "priority": "CRITICAL | HIGH | MEDIUM" }
  ],
  "opportunities": [
    { "title": "short", "desc": "one sentence", "impact": "short tag, e.g. Unlock $250K+" }
  ],
  "nextStepHeadline": "short",
  "nextStepBody": "2-3 sentences leading to a strategy call",
  "opportunityFlags": ["MERCHANT_PROCESSING_OPP"],
  "strategistBrief": "INTERNAL-ONLY brief for the CFO consultant — NEVER shown to the client. 2-3 short paragraphs covering: (1) why this lead got their path verdict — which specific signals in their answers triggered it; (2) the top 2 upsell angles based on the opportunity flags fired and what's underneath their answers; (3) a single suggested opener question the consultant should use to open the strategy call. Write in consultant-to-consultant voice — direct, no fluff."
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
      max_tokens: 2500,
      system: [
        { type: "text", text: ASSESSMENT_RUBRIC, cache_control: { type: "ephemeral" } }
      ],
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

// Wrap inline-styled report body in a full standalone HTML page for the /report endpoint.
// Used when someone clicks "View Report Online" from an email.
function buildReportPage(reportBody, tierLabel, contactName, tier, env, contactEmail, contactId) {
  const e = escapeHtml;
  const paymentLink47 = (env && env.PAYMENT_LINK_47) || CONFIG.PAYMENT_LINK_47;
  const paymentLink297 = (env && env.PAYMENT_LINK_297) || CONFIG.PAYMENT_LINK_297;
  const bookingLink47 = (env && env.BOOKING_LINK_47) || CONFIG.BOOKING_LINK_47;
  const bookingLink297 = (env && env.BOOKING_LINK_297) || CONFIG.BOOKING_LINK_297;
  const logoSrc = "https://assets.cdn.filesafe.space/oLIENQCtGnt9U6gfLhE5/media/6a57c2731097b811951d0e7d.png";
  const emailParam = contactEmail ? `?email=${encodeURIComponent(contactEmail)}` : "";
  // Beta / coupon-bypass mode: HL payment links require a card even on 100%-off coupons.
  // Setting env.UPGRADE_47_URL swaps the free→$47 CTA target from payment to whatever URL
  // is set (e.g. the $47 survey directly). Set env.UPGRADE_297_URL for the equivalent
  // $47→$297 bypass. Both fall back to the normal payment links.
  const upgrade47Href = (env && env.UPGRADE_47_URL) || paymentLink47;
  const upgrade297Href = (env && env.UPGRADE_297_URL) || paymentLink297;

  // Tier-appropriate CTA block rendered UNDER the report card
  let cta = "";
  if (tier === "free") {
    // Beta cohort bypass: user enters SOLOMON50 → CTA swaps to survey (skips paywall).
    // Only active when env.UPGRADE_47_URL is set (coupon target = upgrade47Href).
    // When UPGRADE_47_URL is unset, upgrade47Href === paymentLink47, so the coupon
    // would just re-point at payment — pointless — so we hide the coupon row entirely.
    const couponEnabled = Boolean(env && env.UPGRADE_47_URL);
    const couponRow = couponEnabled ? `
        <div class="coupon-row" id="coupon-row">
          <label for="coupon-input" class="coupon-label">Have a beta code?</label>
          <div class="coupon-inputgroup">
            <input id="coupon-input" type="text" placeholder="Enter code (e.g. SOLOMON50)" autocomplete="off" spellcheck="false">
            <button type="button" id="coupon-apply">Apply</button>
          </div>
          <p class="coupon-msg" id="coupon-msg" aria-live="polite"></p>
        </div>` : "";
    const couponScript = couponEnabled ? `
        <script>
          (function () {
            var input = document.getElementById('coupon-input');
            var apply = document.getElementById('coupon-apply');
            var msg = document.getElementById('coupon-msg');
            var cta = document.getElementById('upgrade-cta');
            var label = document.getElementById('upgrade-label');
            var micro = document.getElementById('upgrade-micro');
            var chip = document.querySelector('.cta-panel .upgrade-chip');
            var VALID = { 'SOLOMON50': { href: cta.dataset.betaHref, label: 'Claim My Beta Access — Full Diagnostic', micro: 'Beta cohort · SOLOMON50 applied · skip payment, go straight to intake.' } };
            var CONTACT_ID = ${JSON.stringify(contactId || "")};
            function tryCoupon() {
              var code = (input.value || '').trim().toUpperCase();
              if (!code) return;
              if (VALID[code]) {
                var v = VALID[code];
                cta.href = v.href;
                label.textContent = v.label;
                micro.textContent = v.micro;
                msg.textContent = '✓ Code applied — payment bypassed.';
                msg.className = 'coupon-msg ok';
                if (chip) chip.textContent = '◆ BETA COHORT · ' + code + ' APPLIED';
                input.disabled = true;
                apply.disabled = true;
                apply.textContent = 'Applied';
                if (CONTACT_ID) {
                  fetch('/apply-solomon50', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contactId: CONTACT_ID, code: code })
                  }).catch(function () { /* tag write is best-effort; UX proceeds regardless */ });
                }
              } else {
                msg.textContent = 'That code isn\\'t recognized. Double-check spelling.';
                msg.className = 'coupon-msg err';
              }
            }
            apply.addEventListener('click', tryCoupon);
            input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); tryCoupon(); } });
          })();
        </script>` : "";
    cta = `
      <div class="cta-panel">
        <span class="upgrade-chip">↑ UPGRADE · BUSINESS ANALYSIS</span>
        <p class="eyebrow gold">FROM SURFACE READ TO FULL DIAGNOSIS</p>
        <h2>Your free report shows what's wrong.<br><em>The $47 version shows what to do about it.</em></h2>
        <p class="sub">Full 8–12 page report · Strategist brief · 30-minute session with a real fractional CFO. All delivered same day.</p>
${couponRow}
        <a class="btn btn-primary" id="upgrade-cta" href="${paymentLink47}" data-payment-href="${paymentLink47}" data-beta-href="${upgrade47Href}">
          <span id="upgrade-label">Upgrade to Full Diagnostic — $47</span>
          <span class="arrow">→</span>
        </a>
        <p class="micro" id="upgrade-micro">One-time payment. No subscription. No follow-up sales calls unless you book one.</p>
${couponScript}
      </div>`;
  } else if (tier === "paid_47") {
    cta = `
      <div class="cta-panel">
        <span class="upgrade-chip">↑ UPGRADE · DEEP DIVE ENGAGEMENT</span>
        <p class="eyebrow gold">FROM DIAGNOSIS TO EXECUTION</p>
        <h2>You have the diagnosis.<br><em>Now let's build the intervention.</em></h2>
        <p class="sub">The Deep Dive is a 90-day engagement with a real CFO who walks the plan with you — Business Playbook, weekly check-ins, hands-on implementation.</p>
        <a class="btn btn-primary" href="${upgrade297Href}">Upgrade to Deep Dive — $297 <span class="arrow">→</span></a>
        <p class="micro">Or book your included 30-minute strategy call first:<br>
          <a class="ghost-link" href="${bookingLink47}">Book my strategy session →</a></p>
      </div>`;
  } else if (tier === "paid_297") {
    cta = `
      <div class="cta-panel">
        <p class="eyebrow gold">FINAL STEP · BOOK YOUR DEEP DIVE</p>
        <h2>Your Business Playbook is <em>ready.</em></h2>
        <p class="sub">Pick a time below for your 50-minute session with your strategist. We'll walk the plan together and start execution.</p>
        <div class="cfobd-calendar" style="max-width:820px;margin:24px auto 0;background:#fafaf7;border:1px solid var(--line);border-radius:10px;overflow:hidden;">
          <iframe
            src="${bookingLink297}${emailParam}"
            style="width:100%;min-height:820px;border:0;display:block;"
            title="Book your 50-minute Deep Dive session"
            loading="lazy"
            allow="clipboard-write"></iframe>
        </div>
        <p class="micro" style="margin-top:22px;">
          Trouble with the calendar?
          <a class="ghost-link" href="${bookingLink297}${emailParam}" target="_blank" rel="noopener">Open booking in a new window →</a>
        </p>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(tierLabel)} — CFO by Design</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,500;1,600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:#0a0e14; --card:#12181f; --line:#1e2632;
    --ink:#f2ecdf; --ink-mute:#a8b0bd; --ink-dim:#6d7480;
    --gold:#d4b565; --gold-bright:#f2c94c; --green:#4ade80;
    --serif:'Playfair Display',Georgia,serif;
    --sans:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Helvetica,Arial,sans-serif;
    --mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
  }
  *,*::before,*::after { box-sizing:border-box; }
  html,body { margin:0; padding:0; }
  body { background:var(--bg); color:var(--ink); font-family:var(--sans); font-size:16px; line-height:1.6; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:820px; margin:0 auto; padding:0 24px; }

  .topbar { padding:24px 0; border-bottom:1px solid rgba(255,255,255,0.05); }
  .topbar .wrap { display:flex; align-items:center; justify-content:space-between; gap:20px; }
  .logo img { height:52px; width:auto; display:block; }
  .tier-chip { font-family:var(--mono); font-size:11px; letter-spacing:0.22em; text-transform:uppercase; color:var(--green); }

  .hello { padding:40px 0 24px; text-align:center; }
  .hello .eyebrow { font-family:var(--mono); font-size:12px; letter-spacing:0.22em; text-transform:uppercase; color:var(--green); margin:0 0 12px; }
  .hello h1 { font-family:var(--serif); font-weight:600; font-size:clamp(28px,4vw,42px); line-height:1.1; margin:0; }
  .hello h1 em { font-style:italic; color:var(--gold); font-weight:500; }

  .report-card {
    background:#fafaf7; color:#1a1a1a;
    max-width:820px; margin:24px auto 0;
    padding:44px 40px; border-radius:12px;
    box-shadow:0 20px 60px rgba(0,0,0,0.35);
    border:1px solid rgba(212,181,101,0.15);
  }
  .report-card a { color:#92400e; }

  .cta-panel {
    max-width:820px; margin:32px auto 0;
    padding:44px 36px 40px;
    background:linear-gradient(180deg, rgba(212,181,101,0.06), rgba(212,181,101,0.02));
    border:1px solid var(--line); border-radius:12px;
    text-align:center;
  }
  .cta-panel .coupon-row {
    max-width:440px; margin:22px auto 24px; text-align:center;
  }
  .cta-panel .coupon-label {
    display:block; font-family:var(--mono); font-size:11px; letter-spacing:0.18em; text-transform:uppercase;
    color:var(--ink-mute); margin:0 0 8px;
  }
  .cta-panel .coupon-inputgroup {
    display:flex; gap:8px; justify-content:center; align-items:stretch;
  }
  .cta-panel .coupon-inputgroup input {
    flex:1; min-width:0; padding:11px 14px; border-radius:6px;
    background:rgba(255,255,255,0.04); border:1px solid var(--line);
    color:var(--ink); font-family:var(--sans); font-size:14px; letter-spacing:0.05em;
    outline:none; transition:border-color .15s;
  }
  .cta-panel .coupon-inputgroup input:focus { border-color:var(--gold); }
  .cta-panel .coupon-inputgroup input:disabled { opacity:.6; cursor:not-allowed; }
  .cta-panel .coupon-inputgroup button {
    padding:11px 18px; border-radius:6px; border:1px solid var(--line);
    background:transparent; color:var(--ink); font-family:var(--sans); font-weight:600; font-size:13px;
    cursor:pointer; transition:border-color .15s, color .15s;
  }
  .cta-panel .coupon-inputgroup button:hover:not(:disabled) { border-color:var(--gold); color:var(--gold); }
  .cta-panel .coupon-inputgroup button:disabled { opacity:.6; cursor:not-allowed; }
  .cta-panel .coupon-msg { margin:8px 0 0; font-family:var(--mono); font-size:11px; letter-spacing:0.05em; min-height:14px; }
  .cta-panel .coupon-msg.ok  { color:var(--green); }
  .cta-panel .coupon-msg.err { color:var(--red); }
  .cta-panel .upgrade-chip {
    display:inline-block; padding:6px 14px; margin:0 0 18px;
    background:rgba(74,222,128,0.10); border:1px solid rgba(74,222,128,0.35);
    color:var(--green); border-radius:999px;
    font-family:var(--mono); font-size:11px; letter-spacing:0.22em; text-transform:uppercase; font-weight:600;
  }
  .cta-panel .eyebrow { font-family:var(--mono); font-size:12px; letter-spacing:0.22em; text-transform:uppercase; margin:0 0 14px; color:var(--green); }
  .cta-panel .eyebrow.gold { color:var(--gold); }
  .cta-panel h2 { font-family:var(--serif); font-weight:600; font-size:clamp(24px,3vw,32px); line-height:1.2; margin:0 0 16px; color:var(--ink); }
  .cta-panel h2 em { font-style:italic; color:var(--gold); font-weight:500; }
  .cta-panel .sub { color:var(--ink-mute); font-size:15.5px; line-height:1.55; max-width:600px; margin:0 auto 28px; }
  .cta-panel .micro { color:var(--ink-dim); font-size:13px; margin:18px 0 0; }
  .cta-panel .ghost-link { color:var(--gold); text-decoration:underline; }

  .btn {
    display:inline-flex; align-items:center; gap:10px;
    padding:14px 28px; border-radius:6px; border:1px solid transparent;
    font-family:var(--sans); font-weight:600; font-size:15px;
    text-decoration:none; cursor:pointer; transition:transform .15s, background .15s;
  }
  .btn-primary { background:var(--gold-bright); color:#0a0e14; border-color:var(--gold-bright); }
  .btn-primary:hover { background:#f8d363; transform:translateY(-1px); }
  .btn .arrow { font-size:18px; line-height:1; }

  .footer { text-align:center; padding:36px 24px 30px; margin-top:48px; border-top:1px solid rgba(255,255,255,0.05); font-family:var(--mono); font-size:11px; letter-spacing:0.22em; text-transform:uppercase; color:var(--ink-dim); }
  .footer a { color:var(--ink-dim); text-decoration:none; margin:0 10px; }
  .footer a:hover { color:var(--gold); }
</style>
</head>
<body>
  <header class="topbar">
    <div class="wrap">
      <span class="logo"><img src="${logoSrc}" alt="CFO by Design"></span>
      <span class="tier-chip">${e(tierLabel).toUpperCase()}</span>
    </div>
  </header>

  <section class="hello">
    <div class="wrap">
      <p class="eyebrow">◆ YOUR REPORT · READY</p>
      <h1>${e(contactName.split(' ')[0] || contactName)}, your <em>diagnostic</em> is back.</h1>
    </div>
  </section>

  <div class="report-card">
    ${reportBody}
  </div>

  ${cta}

  <footer class="footer">
    CFO by Design · cfobydesign.com
    · <a href="mailto:support@cfobydesign.com">Contact</a>
    · <a href="https://www.cfobydesign.com/privacy">Privacy</a>
    · <a href="https://www.cfobydesign.com/tos">Terms</a>
  </footer>
</body>
</html>`;
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

// Fire an event to the HL Inbound Webhook (Workflow trigger). Non-blocking:
// runs inside a Promise.allSettled so its failure never breaks the primary
// GHL writeback. Skips silently if no webhook URL is configured.
async function fireTrackingEvent(payload, env) {
  const url = env.HL_TRACKING_WEBHOOK || CONFIG.HL_TRACKING_WEBHOOK;
  if (!url) return { skipped: true };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, ts: new Date().toISOString() }),
    });
    if (!res.ok) {
      console.warn("[track] HL webhook non-2xx:", res.status, await res.text().catch(() => ""));
    }
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.warn("[track] HL webhook error:", err && err.message);
    return { ok: false, error: err && err.message };
  }
}

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

// GET /report/{contactId}/status — lightweight JSON check the analyzing UI polls
// to know when Solomon has written the report to the contact. Returns
// { ready: bool, tier: string } — no HTML rendering, no CTA construction.
async function handleReportStatus(contactId, env) {
  if (!contactId || !env.GHL_API_KEY) return json({ ready: false, error: "not_configured" }, 200);
  const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/${contactId}`, {
    headers: { Authorization: `Bearer ${env.GHL_API_KEY}`, Version: "2021-07-28" },
  });
  if (!res.ok) return json({ ready: false, error: "contact_not_found" }, 200);
  const data = await res.json().catch(() => ({}));
  const c = data?.contact || {};
  const tags = (c.tags || []).map((t) => String(t).toLowerCase());
  let reportFieldKey, tier;
  if (tags.includes("swot_paid_297")) { reportFieldKey = "business_playbook"; tier = "paid_297"; }
  else if (tags.includes("swot_paid_47")) { reportFieldKey = "swot_full_report"; tier = "paid_47"; }
  else { reportFieldKey = "swot_free_report"; tier = "free"; }
  const cfs = c.customFields || [];
  const reportFieldId = CONFIG.REPORT_FIELD_IDS[reportFieldKey];
  const found = cfs.find((f) => (reportFieldId && f.id === reportFieldId) ||
    (f.fieldKey || f.key || "") === `contact.${reportFieldKey}` ||
    (f.fieldKey || f.key || "") === reportFieldKey);
  const ready = Boolean((found?.value || found?.field_value || "").toString().trim());
  return json({ ready, tier });
}

// GET /report/{contactId} — serve the contact's stored report as a styled standalone HTML page.
// Tier is determined from the contact's tags (swot_paid_297 / swot_paid_47 / swot_free_lead).
// Used by "View Report Online" links written to swot_report_path on every successful run.
async function handleReport(contactId, env) {
  if (!contactId) {
    return new Response("Missing contact id", { status: 400, headers: htmlHeaders() });
  }
  if (!env.GHL_API_KEY) {
    return new Response("Server not configured", { status: 500, headers: htmlHeaders() });
  }

  const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/${contactId}`, {
    headers: {
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
    },
  });
  if (!res.ok) {
    return new Response("Report not found", { status: 404, headers: htmlHeaders() });
  }

  const data = await res.json().catch(() => ({}));
  const c = data?.contact || {};
  const tags = (c.tags || []).map((t) => String(t).toLowerCase());

  // Determine tier from tags — highest paid tier wins if multiple are present.
  let reportFieldKey, tierLabel, tier;
  if (tags.includes("swot_paid_297")) {
    reportFieldKey = "business_playbook";
    tierLabel = "Business Playbook";
    tier = "paid_297";
  } else if (tags.includes("swot_paid_47")) {
    reportFieldKey = "swot_full_report";
    tierLabel = "Full Diagnostic";
    tier = "paid_47";
  } else {
    reportFieldKey = "swot_free_report";
    tierLabel = "SWOT Diagnostic";
    tier = "free";
  }

  // Find the report content. GHL v2 contact GET returns customFields keyed by `id`
  // (not `fieldKey`), so we look up by the known field ID for this location.
  // Fall back to fieldKey/key matching for forward-compatibility if a future API
  // version starts returning those.
  const customFields = c.customFields || [];
  const reportFieldId = CONFIG.REPORT_FIELD_IDS[reportFieldKey];
  const reportField = customFields.find((f) => {
    if (reportFieldId && f.id === reportFieldId) return true;
    const key = f.fieldKey || f.key || "";
    return key === `contact.${reportFieldKey}` || key === reportFieldKey;
  });
  const reportContent = reportField?.value || reportField?.field_value || "";

  if (!reportContent) {
    const fallback = `
      <style>
        @keyframes cfobd-pulse { 0%,100% { opacity:.3; transform:scale(0.9); } 50% { opacity:1; transform:scale(1.1); } }
        @keyframes cfobd-fade  { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .analyzing { text-align:center; padding:36px 20px 40px; animation:cfobd-fade .5s ease-out; }
        .analyzing .dots { display:inline-flex; gap:10px; margin:6px 0 26px; }
        .analyzing .dots span {
          width:12px; height:12px; border-radius:50%; background:#d4b565;
          animation: cfobd-pulse 1.2s infinite ease-in-out;
        }
        .analyzing .dots span:nth-child(2) { animation-delay: .2s; }
        .analyzing .dots span:nth-child(3) { animation-delay: .4s; }
        .analyzing h3 {
          font-family:Georgia,serif; font-size:24px; font-weight:600; color:#1a1a1a;
          margin:6px 0 12px; line-height:1.2;
        }
        .analyzing .sub { color:#6b7280; font-size:15px; line-height:1.55; max-width:440px; margin:0 auto 8px; }
        .analyzing .step { color:#9ca3af; font-family:ui-monospace,Menlo,monospace; font-size:11px; letter-spacing:.15em; text-transform:uppercase; margin-top:20px; }
      </style>
      <div class="analyzing" id="analyzing">
        <div class="dots"><span></span><span></span><span></span></div>
        <h3>Solomon is analyzing your business.</h3>
        <p class="sub">Reading your answers, scoring the SWOT, and drafting your personalized report. This typically takes 30–60 seconds.</p>
        <p class="step" id="analyzing-step">READING YOUR ANSWERS…</p>
      </div>
      <script>
        (function () {
          var steps = [
            'READING YOUR ANSWERS…',
            'SCORING STRENGTHS &amp; WEAKNESSES…',
            'IDENTIFYING OPPORTUNITIES…',
            'DRAFTING YOUR REPORT…',
            'FINALIZING RECOMMENDATIONS…'
          ];
          var i = 0;
          var stepEl = document.getElementById('analyzing-step');
          var stepInterval = setInterval(function () {
            i = (i + 1) % steps.length;
            if (stepEl) stepEl.innerHTML = steps[i];
          }, 4000);

          // Contact id parsed from the current URL /report/{contactId}
          var pathParts = window.location.pathname.split('/').filter(Boolean);
          var contactId = pathParts[pathParts.length - 1] || '';
          var pollUrl = window.location.origin + '/report/' + encodeURIComponent(contactId) + '/status';

          function showReady() {
            clearInterval(stepInterval);
            var wrap = document.getElementById('analyzing');
            if (!wrap) return;
            wrap.innerHTML =
              '<div style="display:inline-flex;align-items:center;justify-content:center;' +
                'width:56px;height:56px;border-radius:50%;background:rgba(74,222,128,0.14);' +
                'color:#4ade80;font-size:28px;margin:0 auto 18px;">✓</div>' +
              '<h3 style="font-family:Georgia,serif;font-size:26px;font-weight:600;color:#1a1a1a;margin:0 0 10px;">Your report is ready.</h3>' +
              '<p style="color:#6b7280;font-size:15px;max-width:440px;margin:0 auto 24px;">' +
                'Solomon finished the diagnosis. Take a look when you\\'re ready.</p>' +
              '<a href="' + window.location.pathname + '" ' +
                'style="display:inline-block;padding:14px 32px;background:#f2c94c;color:#0a0e14;' +
                'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;' +
                'font-weight:700;font-size:15px;letter-spacing:.02em;border-radius:6px;' +
                'text-decoration:none;transition:transform .15s;">' +
                'See My Results <span style="font-size:18px;line-height:1;margin-left:6px;">→</span>' +
              '</a>';
          }

          function showTimeout() {
            clearInterval(stepInterval);
            var wrap = document.getElementById('analyzing');
            if (!wrap) return;
            wrap.innerHTML =
              '<h3 style="font-family:Georgia,serif;font-size:22px;color:#1a1a1a;margin:0 0 10px;">Still working on your report…</h3>' +
              '<p style="color:#6b7280;font-size:15px;max-width:460px;margin:0 auto 6px;">' +
                'This usually takes 30–60 seconds. If the wait feels long, refresh manually or email ' +
                '<a href="mailto:support@cfobydesign.com" style="color:#92400e;">support@cfobydesign.com</a> ' +
                'and we\\'ll dig in.</p>';
          }

          var elapsed = 0;
          var MAX_SECONDS = 150; // 2.5 min
          var POLL_INTERVAL_MS = 4000;
          var pollTimer;

          function poll() {
            fetch(pollUrl, { cache: 'no-store', headers: { 'Accept': 'application/json' } })
              .then(function (r) { return r.ok ? r.json() : { ready: false }; })
              .then(function (data) {
                if (data && data.ready) { showReady(); return; }
                elapsed += POLL_INTERVAL_MS / 1000;
                if (elapsed >= MAX_SECONDS) { showTimeout(); return; }
                pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
              })
              .catch(function () {
                // Network hiccup — keep trying until timeout.
                elapsed += POLL_INTERVAL_MS / 1000;
                if (elapsed >= MAX_SECONDS) { showTimeout(); return; }
                pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
              });
          }
          // Kick off — 2s delay to let the initial UI settle before the first poll.
          setTimeout(poll, 2000);
        })();
      </script>`;
    return new Response(buildReportPage(fallback, tierLabel, "Business Owner", tier, env, c.email || "", contactId), {
      status: 200,
      headers: htmlHeaders(),
    });
  }

  // Report is ready → clear any pending analyzing timer state on next load
  const readyPrelude = `<script>try{sessionStorage.removeItem('cfobd-elapsed');}catch(e){}</script>`;
  const reportWithReset = readyPrelude + reportContent;

  const contactName =
    c.firstName || c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Business Owner";

  return new Response(buildReportPage(reportWithReset, tierLabel, contactName, tier, env, c.email || "", contactId), {
    status: 200,
    headers: htmlHeaders(),
  });
}

// POST /apply-solomon50 — tag a contact when they redeem the SOLOMON50 beta code
// on the free report page. Fires from the report page's coupon-apply JS. Best-effort:
// UX proceeds regardless of tag-write success. No auth needed — worst case is a
// contactId + tag write, no data exfiltration or paid-tier escalation.
async function handleApplySolomon50(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = body.contactId || body.contact_id;
  const code = String(body.code || "").trim().toUpperCase();
  if (!contactId) return json({ success: false, error: "Missing contactId" }, 400);
  if (code !== "SOLOMON50") return json({ success: false, error: "Unrecognized code" }, 400);
  if (!env.GHL_API_KEY) return json({ success: false, error: "GHL not configured" }, 500);

  const ok = await addGHLTag(contactId, ["swot_solomon50_applied"], env);
  return json({ success: ok });
}

// ----- Ask Solomon console (internal training & testing) -----

// Validate console access. Accepts EITHER:
//   1. Password via x-console-password header (matches env.CONSOLE_PASSWORD) — normal login
//   2. Embed token via x-console-password header (matches env.CONSOLE_EMBED_TOKEN) — for
//      iframe embeds (e.g., inside GHL dashboard). Bypasses the gate when passed in the URL.
// Constant-time-ish comparison: short strings, low risk for timing attacks at our volume.
function checkConsolePassword(request, env) {
  const provided = request.headers.get("x-console-password");
  if (!provided) return false;
  if (env.CONSOLE_PASSWORD && provided === env.CONSOLE_PASSWORD) return true;
  if (env.CONSOLE_EMBED_TOKEN && provided === env.CONSOLE_EMBED_TOKEN) return true;
  return false;
}

// POST /asksolomon/run — runs the SWOT assessment without GHL writeback.
// Supports `rubricOverride` to test rubric variants ephemerally.
// Probe requests (body.probe === true) just validate the password and return 200.
async function handleConsoleRun(request, env, ctx, requestUrl) {
  if (!checkConsolePassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  // Auth probe — used by the gate to verify the password without a real run.
  if (body && body.probe) return json({ success: true, probe: true });

  const tier = body.tier || "free";
  const contact = body.contact || {};
  const businessProfile = body.businessProfile || {};
  const answers = normalizeAnswers(body.answers);
  if (!answers.length) return json({ success: false, error: "No answers provided" }, 400);

  // Build the user prompt the normal way. Then call Claude with either the default
  // rubric (cache-eligible) or the override (cache-busted but still works).
  const prompt = buildPrompt(tier, answers, contact, businessProfile);

  // If the caller selected library items, fetch their content and append as
  // reference material to the base rubric. Deliberately AFTER the rubric override
  // check so a user can also test rubric variants + library items together.
  const libraryIds = Array.isArray(body.libraryIds) ? body.libraryIds : [];
  const libraryContext = libraryIds.length ? await buildLibraryContext(env, libraryIds) : "";

  const baseRubric = (typeof body.rubricOverride === "string" && body.rubricOverride.trim())
    ? body.rubricOverride
    : ASSESSMENT_RUBRIC;
  const rubric = libraryContext ? (baseRubric + libraryContext) : baseRubric;

  let agent;
  const startedAt = Date.now();
  try {
    const raw = await callClaudeWithRubric(prompt, rubric, env);
    agent = parseAgentJson(raw);
  } catch (err) {
    return json({ success: false, error: err.message }, 500);
  }
  const elapsedMs = Date.now() - startedAt;

  // Free-tier digital-presence scrub matches production behavior.
  if (tier === "free") {
    agent.opportunityFlags = (agent.opportunityFlags || []).filter(f => f !== "DIGITAL_PRESENCE_OPP");
  }

  const reportHtml = buildReportHtml(agent);

  // OPT-IN GHL writeback: if an email is provided, treat this like a real submission —
  // create/update the contact, populate fields, apply tags. The existing tier
  // workflow in GHL (00 SWOT Free Report / 01 $47 / 02 $297) will then fire and send
  // the production-style email to whoever's address was provided. Tag with
  // SWOT_CONSOLE_TEST so these contacts can be distinguished from real leads.
  let emailedTo = null;
  if (contact.email && ctx && requestUrl) {
    try {
      const contactId = await resolveGHLContactId(contact, env);
      if (contactId) {
        const reportFieldKey =
          tier === "paid_297" ? "business_playbook"
          : tier === "paid_47" ? "swot_full_report"
          : "swot_free_report";

        const fields = [
          { key: "swot_path", field_value: String(agent.path || "") },
          { key: "swot_rehab_flag", field_value: agent.path === "rehab" ? "true" : "false" },
          { key: reportFieldKey, field_value: reportHtml },
        ];
        if (agent.opener) fields.push({ key: "swot_email_blurb", field_value: String(agent.opener) });
        if (agent.strategistBrief) fields.push({ key: "swot_strategist_brief", field_value: String(agent.strategistBrief) });
        fields.push({ key: "swot_report_path", field_value: `${requestUrl.origin}/report/${contactId}` });
        if (tier === "paid_297") fields.push({ key: "swot_deep_dive_booked", field_value: "true" });

        const tierTag =
          tier === "paid_297" ? "swot_paid_297"
          : tier === "paid_47" ? "swot_paid_47"
          : "swot_free_lead";
        const tags = [
          tierTag,
          `swot_report_ready_${tier.replace(/^paid_/, "")}`,
          `swot_path_${(agent.path || "").toLowerCase()}`,
          "swot_console_test", // distinguishes test contacts from real leads
          ...(agent.opportunityFlags || []).map((f) => String(f).toLowerCase()),
        ].filter(Boolean);

        ctx.waitUntil(Promise.allSettled([
          updateGHLContact(contactId, fields, env),
          addGHLTag(contactId, tags, env),
        ]));
        emailedTo = contact.email;
      }
    } catch (err) {
      console.error("Console GHL writeback failed:", err.message);
    }
  }

  return json({
    success: true,
    tier,
    rubricUsed: baseRubric === ASSESSMENT_RUBRIC ? "default" : "override",
    libraryItemsIncluded: libraryIds.length,
    libraryContextChars: libraryContext.length,
    reportHtml,
    emailedTo, // null if no email provided; otherwise the address that will receive the workflow email
    elapsedMs, // Anthropic API round-trip time in ms; ~drops after cache hits
    ...agent,
  });
}

// POST /asksolomon/send-result — take a previously-generated agent output
// and email it via the tier's GHL workflow to any specified address.
// Does NOT invoke Solomon. Reuses production writeback path.
async function handleConsoleSendResult(request, env, ctx, requestUrl) {
  if (!checkConsolePassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const tier = body.tier || "free";
  const contact = body.contact || {};
  const agent = body.agent || {};
  const reportHtml = body.reportHtml || "";

  if (!contact.email || !contact.email.includes("@")) {
    return json({ success: false, error: "Valid recipient email required" }, 400);
  }
  if (!agent.path) {
    return json({ success: false, error: "Missing agent output (path required)" }, 400);
  }

  const contactId = await resolveGHLContactId(contact, env);
  if (!contactId) {
    return json({ success: false, error: "Couldn't resolve or create GHL contact" }, 500);
  }

  const reportFieldKey =
    tier === "paid_297" ? "business_playbook"
    : tier === "paid_47" ? "swot_full_report"
    : "swot_free_report";

  const fields = [
    { key: "swot_path", field_value: String(agent.path || "") },
    { key: "swot_rehab_flag", field_value: agent.path === "rehab" ? "true" : "false" },
    { key: reportFieldKey, field_value: reportHtml },
  ];
  if (agent.opener) fields.push({ key: "swot_email_blurb", field_value: String(agent.opener) });
  if (agent.strategistBrief) fields.push({ key: "swot_strategist_brief", field_value: String(agent.strategistBrief) });
  fields.push({ key: "swot_report_path", field_value: `${requestUrl.origin}/report/${contactId}` });
  if (tier === "paid_297") fields.push({ key: "swot_deep_dive_booked", field_value: "true" });

  const tierTag =
    tier === "paid_297" ? "swot_paid_297"
    : tier === "paid_47" ? "swot_paid_47"
    : "swot_free_lead";
  const tags = [
    tierTag,
    `swot_report_ready_${tier.replace(/^paid_/, "")}`,
    `swot_path_${(agent.path || "").toLowerCase()}`,
    "swot_console_manual_send", // distinguishes from live leads and from swot_console_test auto-runs
    ...(agent.opportunityFlags || []).map((f) => String(f).toLowerCase()),
  ].filter(Boolean);

  ctx.waitUntil(Promise.allSettled([
    updateGHLContact(contactId, fields, env),
    addGHLTag(contactId, tags, env),
  ]));

  return json({
    success: true,
    tier,
    sentTo: contact.email,
    contactId,
  });
}

// ----- Reference library (transcripts / testimonials / examples / rubric fragments) -----
// Stored in R2 bucket SOLOMON_LIBRARY. Manifest at library/manifest.json is the index.
// Soft-delete moves the object to SOLOMON_LIBRARY_ARCHIVE and drops it from the manifest.

const LIBRARY_MANIFEST_KEY = "library/manifest.json";
const LIBRARY_CATEGORIES = new Set(["transcript", "testimonial", "example", "rubric_fragment"]);
const LIBRARY_MAX_BYTES = 512 * 1024; // 512KB per file

async function readLibraryManifest(env) {
  if (!env.SOLOMON_LIBRARY) return { items: [] };
  const obj = await env.SOLOMON_LIBRARY.get(LIBRARY_MANIFEST_KEY);
  if (!obj) return { items: [] };
  try { return JSON.parse(await obj.text()); }
  catch { return { items: [] }; }
}

async function writeLibraryManifest(env, manifest) {
  await env.SOLOMON_LIBRARY.put(LIBRARY_MANIFEST_KEY, JSON.stringify(manifest));
}

function estimateTokens(text) {
  // Rough: ~4 chars per token for English. Fine for cost visibility.
  return Math.ceil(String(text || "").length / 4);
}

function randomLibraryId() {
  return "lib_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

// GET /asksolomon/library — return the manifest (list of items with metadata).
async function handleLibraryList(request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "Library storage not configured" }, 500);
  const manifest = await readLibraryManifest(env);
  return json({ success: true, items: manifest.items || [] });
}

// POST /asksolomon/library — multipart upload with fields: category, description, file.
// Stores the file in R2 and appends metadata to the manifest.
async function handleLibraryUpload(request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "Library storage not configured" }, 500);

  let formData;
  try { formData = await request.formData(); }
  catch { return json({ success: false, error: "Invalid multipart/form-data body" }, 400); }

  const file = formData.get("file");
  const category = String(formData.get("category") || "").trim();
  const description = String(formData.get("description") || "").trim();

  if (!file || typeof file === "string") return json({ success: false, error: "Missing 'file' field" }, 400);
  if (!LIBRARY_CATEGORIES.has(category)) {
    return json({ success: false, error: "Invalid category. Must be one of: " + [...LIBRARY_CATEGORIES].join(", ") }, 400);
  }
  if (file.size > LIBRARY_MAX_BYTES) return json({ success: false, error: "File too large (max 512KB per item)" }, 413);

  // Read as text; if it's binary/PDF we still store the raw bytes but Solomon
  // will need text — MVP treats everything as text and warns on decode failure.
  let text;
  try { text = await file.text(); }
  catch { return json({ success: false, error: "Couldn't decode file as text — upload plain .txt or .md" }, 400); }

  if (!text.trim()) return json({ success: false, error: "File is empty" }, 400);

  const id = randomLibraryId();
  const safeName = String(file.name || "unnamed").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const storagePath = `library/${category}/${id}-${safeName}`;

  await env.SOLOMON_LIBRARY.put(storagePath, text, {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
  });

  const manifest = await readLibraryManifest(env);
  manifest.items = manifest.items || [];
  manifest.items.unshift({
    id,
    name: safeName,
    category,
    description: description.slice(0, 500) || "(no description)",
    size: text.length,
    tokenEstimate: estimateTokens(text),
    uploadedAt: new Date().toISOString(),
    storagePath,
  });
  await writeLibraryManifest(env, manifest);

  return json({ success: true, id, item: manifest.items[0] });
}

// DELETE /asksolomon/library/{id} — soft-delete: move to archive bucket, drop from manifest.
async function handleLibraryDelete(id, request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "Library storage not configured" }, 500);

  const manifest = await readLibraryManifest(env);
  const idx = (manifest.items || []).findIndex(i => i.id === id);
  if (idx === -1) return json({ success: false, error: "Item not found" }, 404);

  const item = manifest.items[idx];
  const obj = await env.SOLOMON_LIBRARY.get(item.storagePath);
  if (obj && env.SOLOMON_LIBRARY_ARCHIVE) {
    const text = await obj.text();
    await env.SOLOMON_LIBRARY_ARCHIVE.put(
      `archived/${new Date().toISOString().slice(0, 10)}/${item.storagePath.replace(/^library\//, "")}`,
      text,
      { httpMetadata: { contentType: "text/plain; charset=utf-8" } }
    );
  }
  await env.SOLOMON_LIBRARY.delete(item.storagePath);
  manifest.items.splice(idx, 1);
  await writeLibraryManifest(env, manifest);
  return json({ success: true, id });
}

// Given a list of library item ids, fetch their content and return a labeled
// concatenated string to append to Solomon's system prompt.
async function buildLibraryContext(env, ids) {
  if (!env.SOLOMON_LIBRARY || !ids || !ids.length) return "";
  const manifest = await readLibraryManifest(env);
  const included = manifest.items.filter(i => ids.includes(i.id));
  if (!included.length) return "";
  const chunks = await Promise.all(included.map(async (item) => {
    const obj = await env.SOLOMON_LIBRARY.get(item.storagePath);
    if (!obj) return "";
    const body = await obj.text();
    const catLabel = item.category.replace("_", " ").toUpperCase();
    return `\n=== ${catLabel}: ${item.name}${item.description && item.description !== "(no description)" ? " — " + item.description : ""} ===\n${body}\n=== END ${catLabel} ===\n`;
  }));
  const combined = chunks.filter(Boolean).join("\n");
  return combined
    ? `\n\n== REFERENCE MATERIAL from Miguel's library (transcripts, testimonials, examples). Learn from Miguel's voice + patterns. Do NOT quote verbatim to the client — use as internal reference only. ==${combined}\n== END REFERENCE MATERIAL ==\n`
    : "";
}
// ----- end reference library -----

// ----- GHL survey webhook — the "no more Vibe" bridge -----
// GHL surveys write answers into contact custom fields. This endpoint receives
// a GHL workflow webhook after a survey submits, fetches the contact, maps
// field IDs to human-readable questions, runs Solomon, and writes back.
// Solomon lives on Cloudflare Worker — nothing hits Vibe.

// Maps GHL custom-field IDs → the labeled question Solomon should see.
// Free-tier IDs known from the Vibe app export (AssessmentScreen.tsx).
// $47 and $297 fields fall back to whatever value+ID pair GHL returns; the
// worker synthesizes a question from the field ID if not in the map (Solomon
// figures out semantics from the answer text at that point).
const SURVEY_FIELD_MAP = {
  // FREE tier (P1-P3 + Q1-Q8)
  "5VWVNRrQYcLqXhckh4f4": "What best describes your business type?",
  "nCRqWH0x1sdJIgUPDr2E": "How do you primarily reach your customers?",
  "nbPL6APmjrjr43J6urVb": "What industry or vertical best describes your business?",
  "OyQjw4nGNHJYADsq5ggg": "Do you currently have any active judgments, tax liens, or corporate debt you're actively managing?",
  "8sSKohKtQZZzJEtM2ju0": "When you make business decisions, are you basing them on your actual numbers or on what's in your bank account?",
  "deItnw0p1H7sO1okRjGS": "What does your business consistently deliver that your clients say they can't get anywhere else?",
  "hV9yij5uFitztZzanSaa": "When a client refers you, what specific words or outcome do they use to describe what you did for them?",
  "ngBePHf4iKPhaHm2OtSv": "Where does revenue most often leak in your business?",
  "cvuAgfuL94eBahOrnTY0": "What would change in your business if you had 20% more profit on the same revenue?",
  "cdlV9zqJxztcxfXgD4J0": "Where do you see demand in your market that you're not yet positioned to capture?",
  "qKRvCyjprebbK75tC05h": "What would happen to your business if your single largest client, revenue source, or referral channel disappeared in the next 90 days?",
};

// Fields Solomon writes to and should never re-consume as "answers" — otherwise
// a re-triggered run would feed the previous report back as an intake answer.
const SOLOMON_OWNED_FIELDS = new Set([
  "Ys28pMUc82cURfnsbQzY", // swot_free_report
  "pa6VF4GsufGuTAjlFVnf", // swot_full_report
  "XEuWL4vobueOpZGBFdLm", // business_playbook
  "UnnWDCV53D8UZp1QHs6M", // swot_path
  "v8aZ5KjE8GDXDX0S8z0d", // swot_rehab_flag
  "OnB1KqsPr0OHHidW3K3g", // swot_deep_dive_booked
  "kmZcNfFytZzwd6PbE7AT", // swot_strategist_brief
  "wjWicVUPs2IiXSl7gzBs", // swot_email_blurb
  "2tOTD1ifIR1G9ayA0Y8t", // swot_report_path
]);

async function fetchGHLContact(contactId, env) {
  if (!contactId || !env.GHL_API_KEY) return null;
  const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/${contactId}`, {
    headers: {
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
    },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data?.contact || null;
}

// Build the {question, answer} array Solomon expects from the contact's
// custom fields. Fields listed in SURVEY_FIELD_MAP get their curated
// question label. Unmapped fields (typically paid-tier questions whose
// GHL IDs haven't been added to the map yet) fall back to the field's own
// GHL-provided label (`name` / `fieldKey` / `key`) so their answers still
// reach Solomon rather than being silently dropped. Fields with no label
// available anywhere are dropped as truly opaque.
//
// The tradeoff — a fallback label like "monthly_revenue" isn't as precise
// as a curated one like "What's your monthly recurring revenue?", but it
// is far more informative than losing the answer entirely. Adding paid-tier
// IDs to SURVEY_FIELD_MAP is still the preferred long-term fix.
function answersFromContactFields(contact) {
  const cfs = contact?.customFields || [];
  const dropped = [];
  const mapped = cfs
    .filter(f => f && f.value && String(f.value).trim() && !SOLOMON_OWNED_FIELDS.has(f.id))
    .map(f => {
      const curated = SURVEY_FIELD_MAP[f.id];
      const fallback = f.name || f.fieldKey || f.key || null;
      const question = curated || fallback;
      if (!question) {
        dropped.push(f.id);
        return null;
      }
      return {
        question,
        answer: String(f.value).trim(),
        _source: curated ? "mapped" : "fallback",
      };
    })
    .filter(Boolean)
    .map(({ _source, ...rest }) => rest);
  if (dropped.length) {
    console.warn(`[answersFromContactFields] Dropped ${dropped.length} truly-opaque custom field(s) (no label anywhere): ${dropped.join(", ")}.`);
  }
  return mapped;
}

// POST /from-ghl-survey — GHL workflow webhook after a survey submits.
// Body: { contactId, tier } — tier is "free" | "paid_47" | "paid_297"
// Optional: rubricOverride (for testing new rubrics against real submissions)
//
// AUTH: Endpoint is publicly reachable, and a contact ID is exposed to end users
// via the /report/{contactId} URL. Without protection anyone can POST here with
// tier=paid_297 and get a Business Playbook generated + swot_paid_297 tag applied.
// Two-layer defense:
//   1. Shared secret in x-webhook-secret header (set env.WEBHOOK_SECRET + the same
//      value on the GHL workflow's webhook step). Required when configured.
//   2. For paid tiers, verify the contact ALREADY carries the matching swot_paid_*
//      tag applied by the payment workflow. Free tier is unrestricted since it
//      corresponds to an intake with no gate.
async function handleGHLSurveyWebhook(request, env, ctx, requestUrl) {
  if (env.WEBHOOK_SECRET) {
    const provided = request.headers.get("x-webhook-secret");
    if (!provided || provided !== env.WEBHOOK_SECRET) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = body.contactId || body.contact_id || body.contact?.id;
  const tier = body.tier || "free";

  if (!contactId) return json({ success: false, error: "Missing contactId in webhook body" }, 400);
  if (!env.GHL_API_KEY) return json({ success: false, error: "GHL not configured" }, 500);

  const contact = await fetchGHLContact(contactId, env);
  if (!contact) return json({ success: false, error: "Contact not found in GHL" }, 404);

  // Defense in depth: paid tiers require the matching lifecycle tag (applied by
  // the GHL payment workflow). Prevents a valid webhook secret from being used
  // to escalate a free lead's tier and generate paid content without payment.
  if (tier === "paid_47" || tier === "paid_297") {
    const requiredTag = tier === "paid_297" ? "swot_paid_297" : "swot_paid_47";
    const contactTags = (contact.tags || []).map(t => String(t).toLowerCase());
    if (!contactTags.includes(requiredTag)) {
      return json({ success: false, error: `Contact does not have required ${requiredTag} tag` }, 403);
    }
  }

  const answers = answersFromContactFields(contact);
  if (!answers.length) return json({ success: false, error: "No answers on this contact yet" }, 400);

  const contactPayload = {
    name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.contactName || "Business Owner",
    email: contact.email || "",
    contactId: contact.id,
  };

  const businessProfile = {}; // Reserved for future paid-tier profile fields.
  const prompt = buildPrompt(tier, answers, contactPayload, businessProfile);
  const rubric = ASSESSMENT_RUBRIC;

  let agent;
  const startedAt = Date.now();
  try {
    const raw = await callClaudeWithRubric(prompt, rubric, env);
    agent = parseAgentJson(raw);
  } catch (err) {
    return json({ success: false, error: "Solomon error: " + err.message }, 500);
  }
  const elapsedMs = Date.now() - startedAt;

  if (tier === "free") {
    agent.opportunityFlags = (agent.opportunityFlags || []).filter(f => f !== "DIGITAL_PRESENCE_OPP");
  }

  const reportHtml = buildReportHtml(agent);
  const reportFieldKey =
    tier === "paid_297" ? "business_playbook"
    : tier === "paid_47" ? "swot_full_report"
    : "swot_free_report";

  const fields = [
    { key: "swot_path", field_value: String(agent.path || "") },
    { key: "swot_rehab_flag", field_value: agent.path === "rehab" ? "true" : "false" },
    { key: reportFieldKey, field_value: reportHtml },
  ];
  if (agent.opener) fields.push({ key: "swot_email_blurb", field_value: String(agent.opener) });
  if (agent.strategistBrief) fields.push({ key: "swot_strategist_brief", field_value: String(agent.strategistBrief) });
  fields.push({ key: "swot_report_path", field_value: `${requestUrl.origin}/report/${contactId}` });
  if (tier === "paid_297") fields.push({ key: "swot_deep_dive_booked", field_value: "true" });

  // All tags lowercase. Two tags fire per report generation:
  //   - Lifecycle tag: swot_free_lead / swot_paid_47 / swot_paid_297
  //     (For paid tiers, HL's payment workflow ALREADY applied swot_paid_*.
  //      Re-applying is a no-op; worker also applies for parity in case of manual replays.)
  //   - Report-ready tag: swot_report_ready_free / swot_report_ready_paid_47 / swot_report_ready_paid_297
  //     THIS IS THE EMAIL TRIGGER. Fires only AFTER Solomon has written the report
  //     to the contact — guarantees email templates don't render blank {{contact.swot_*_report}}.
  // Plus: swot_path_* + opportunity flags (LLM-driven).
  const tierTag =
    tier === "paid_297" ? "swot_paid_297"
    : tier === "paid_47" ? "swot_paid_47"
    : "swot_free_lead";
  const reportReadyTag = `swot_report_ready_${tier.replace(/^paid_/, "")}`;
  // Non-email-trigger tags are safe to apply concurrently with the writeback;
  // reportReadyTag is the email trigger and must NOT fire until the report
  // field write has landed, or the email renders with blank merge fields.
  const lifecycleTags = [
    tierTag,
    `swot_path_${(agent.path || "").toLowerCase()}`,
    ...(agent.opportunityFlags || []).map((f) => String(f).toLowerCase()),
  ].filter(Boolean);

  ctx.waitUntil(Promise.allSettled([
    // Chained: writeback must succeed before the email-trigger tag lands.
    // On failure we deliberately skip reportReadyTag so no empty-report email fires.
    updateGHLContact(contactId, fields, env).then(ok => {
      if (ok) return addGHLTag(contactId, [reportReadyTag], env);
      console.warn("[from-ghl-survey] Contact writeback failed; skipping reportReadyTag");
    }),
    addGHLTag(contactId, lifecycleTags, env),
    fireTrackingEvent({
      event_type: `report_generated_${tier}`,
      tier,
      contact_id: contactId,
      email: contact.email || "",
      name: [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || contact.contactName || "",
      business_name: contact.companyName || "",
      path: agent.path || "",
      badge: agent.badge || "",
      headline: agent.headline || "",
      opportunity_flags: agent.opportunityFlags || [],
      answers,
      source: "ghl_survey",
    }, env),
  ]));

  return json({
    success: true,
    tier,
    contactId,
    path: agent.path,
    flags: agent.opportunityFlags || [],
    elapsedMs,
    tagsAppliedAsync: tags,
  });
}
// ----- end GHL survey webhook -----

// Like callClaude but accepts an explicit rubric (for the console's override path).
// When the rubric is the default, cache_control still applies — repeated runs hit the cache.
async function callClaudeWithRubric(prompt, rubric, env) {
  const isDefault = rubric === ASSESSMENT_RUBRIC;
  const systemBlock = [
    isDefault
      ? { type: "text", text: rubric, cache_control: { type: "ephemeral" } }
      : { type: "text", text: rubric }
  ];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": CONFIG.ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 2500,
      system: systemBlock,
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

// ----- end Ask Solomon console -----

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-console-password",
  };
}

function htmlHeaders() {
  return {
    ...corsHeaders(),
    "Content-Type": "text/html; charset=utf-8",
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

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    // GET /report/{contactId} — public-readable hosted report view.
    // GET /asksolomon — internal training console (HTML page, password-protected at the API layer).
    // GET /asksolomon/rubric — return the current ASSESSMENT_RUBRIC (password-protected).
    if (request.method === "GET") {
      // GET /report/{contactId}/status — lightweight JSON readiness check for the
      // client-side analyzing UI to poll without reloading the page.
      const statusMatch = path.match(/^\/report\/([A-Za-z0-9_-]+)\/status$/);
      if (statusMatch) {
        return handleReportStatus(statusMatch[1], env);
      }
      const reportMatch = path.match(/^\/report\/([A-Za-z0-9_-]+)$/);
      if (reportMatch) {
        return handleReport(reportMatch[1], env);
      }
      if (path === "/asksolomon") {
        return new Response(CONSOLE_PAGE, { status: 200, headers: htmlHeaders() });
      }
      if (path === "/asksolomon/rubric") {
        if (!checkConsolePassword(request, env)) {
          return json({ success: false, error: "Unauthorized" }, 401);
        }
        return json({ success: true, rubric: ASSESSMENT_RUBRIC });
      }
      // /asksolomon/diag — UNAUTHENTICATED diagnostic endpoint. Returns only whether
      // CONSOLE_PASSWORD is configured and its character length. NEVER returns the value.
      // Use during setup to confirm Cloudflare environment has the secret.
      if (path === "/asksolomon/diag") {
        const pw = env.CONSOLE_PASSWORD;
        return json({
          passwordConfigured: Boolean(pw),
          passwordLength: typeof pw === "string" ? pw.length : 0,
          hint: "The deployed worker expects password header 'x-console-password' to match env.CONSOLE_PASSWORD exactly (case-sensitive, no trim). If passwordConfigured is false, the secret isn't in this environment.",
        });
      }
      // GET /asksolomon/library — list library items with metadata.
      if (path === "/asksolomon/library") {
        return handleLibraryList(request, env);
      }
      // GET /diag/webhook-secret — confirm WEBHOOK_SECRET is present on this deploy
      // without ever revealing its value. Use this after setting the secret in
      // Cloudflare and before wiring the GHL webhook headers.
      if (path === "/diag/webhook-secret") {
        const s = env.WEBHOOK_SECRET;
        return json({
          configured: Boolean(s),
          length: typeof s === "string" ? s.length : 0,
          hint: "Both the worker (WEBHOOK_SECRET env) and each GHL webhook action's x-webhook-secret header must match exactly. If configured is false, add the secret in Cloudflare → Workers → swot-engine → Settings → Variables and redeploy.",
        });
      }
      return json({ success: false, error: "Not found" }, 404);
    }

    // DELETE /asksolomon/library/{id} — soft-delete a library item (moves to archive).
    if (request.method === "DELETE") {
      const libMatch = path.match(/^\/asksolomon\/library\/([A-Za-z0-9_-]+)$/);
      if (libMatch) return handleLibraryDelete(libMatch[1], request, env);
      return json({ success: false, error: "Not found" }, 404);
    }

    if (request.method !== "POST") return json({ success: false, error: "POST only" }, 405);

    // Route /upload BEFORE JSON parsing — it expects multipart/form-data.
    if (path === "/upload") {
      return handleUpload(request, env);
    }

    // POST /asksolomon/run — console test runs.
    // Optional rubric override + opt-in GHL writeback when contact.email is provided
    // (so the production email workflow fires and the tester receives a real email).
    if (path === "/asksolomon/run") {
      return handleConsoleRun(request, env, ctx, url);
    }

    // POST /asksolomon/send-result — send a PREVIOUSLY GENERATED output to an email.
    // Does NOT re-run Solomon. Writes the provided agent + reportHtml to GHL and
    // applies tier tags, so the existing production workflow delivers the email.
    // Tagged SWOT_CONSOLE_MANUAL_SEND to distinguish from real leads and test runs.
    if (path === "/asksolomon/send-result") {
      return handleConsoleSendResult(request, env, ctx, url);
    }

    // POST /asksolomon/library — multipart upload of a reference item (transcript,
    // testimonial, example analysis, rubric fragment).
    if (path === "/asksolomon/library") {
      return handleLibraryUpload(request, env);
    }

    // POST /apply-solomon50 — tag a contact when they apply the SOLOMON50 beta code
    // on the free report page. Fired by client-side JS in buildReportPage's coupon script.
    if (path === "/apply-solomon50") {
      return handleApplySolomon50(request, env);
    }

    // GET /diag/webhook-secret — verify WEBHOOK_SECRET is set without revealing its value.
    // Returns { configured: true|false, length: N }. Use to confirm the secret exists on
    // this deploy before firing test webhooks from GHL.
    // POST /from-ghl-survey — the "no more Vibe" bridge.
    // GHL workflow fires this webhook after a survey submits with { contactId, tier }.
    // Worker fetches the contact, runs Solomon, writes results + applies tier tag →
    // GHL's tier email workflow (00 / 01 / 02) then fires the delivery email.
    if (path === "/from-ghl-survey") {
      return handleGHLSurveyWebhook(request, env, ctx, url);
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

      // Personalized 1-paragraph hook for delivery emails ({{contact.swot_email_blurb}}).
      // Pulled from the LLM's `opener` — it's already written as a per-lead intro.
      if (agent.opener) {
        fields.push({ key: "swot_email_blurb", field_value: String(agent.opener) });
      }

      // Internal-only consultant brief ({{contact.swot_strategist_brief}}) — path reasoning,
      // upsell angles, opener question. Written on every tier so Miguel sees it before every call.
      if (agent.strategistBrief) {
        fields.push({ key: "swot_strategist_brief", field_value: String(agent.strategistBrief) });
      }

      // Hosted "View Report Online" URL — points at GET /report/{contactId} on this worker.
      // Used in email "View Online" buttons via {{contact.swot_report_path}}.
      fields.push({
        key: "swot_report_path",
        field_value: `${url.origin}/report/${contactId}`,
      });

      if (tier === "paid_297") {
        fields.push({ key: "swot_deep_dive_booked", field_value: "true" });
      }

      // Tag pattern matches the workflows built in GHL. HL tags ARE case-sensitive,
      // and the existing email automations trigger on lowercase swot_paid_47 /
      // swot_paid_297 / swot_free_lead / swot_path_<path>. Do NOT switch back to
      // uppercase — that silently breaks the email sends.
      const tierTag =
        tier === "paid_297" ? "swot_paid_297"
        : tier === "paid_47" ? "swot_paid_47"
        : "swot_free_lead";
      const reportReadyTag = `swot_report_ready_${tier.replace(/^paid_/, "")}`;
      // Same ordering rule as /from-ghl-survey: report-ready tag (email trigger)
      // must land AFTER the writeback. Lifecycle tags are safe to run concurrently.
      const lifecycleTags = [
        tierTag,
        `swot_path_${(agent.path || "").toLowerCase()}`,
        ...(agent.opportunityFlags || []).map((f) => String(f).toLowerCase()),
      ].filter(Boolean);

      ctx.waitUntil(
        Promise.allSettled([
          updateGHLContact(contactId, fields, env).then(ok => {
            if (ok) return addGHLTag(contactId, [reportReadyTag], env);
            console.warn("[POST /] Contact writeback failed; skipping reportReadyTag");
          }),
          addGHLTag(contactId, lifecycleTags, env),
          fireTrackingEvent({
            event_type: `report_generated_${tier}`,
            tier,
            contact_id: contactId,
            email: contact.email || "",
            name: [contact.firstName || contact.first_name, contact.lastName || contact.last_name].filter(Boolean).join(" ").trim() || contact.name || "",
            business_name: contact.businessName || contact.company || businessProfile.name || "",
            path: agent.path || "",
            badge: agent.badge || "",
            headline: agent.headline || "",
            opportunity_flags: agent.opportunityFlags || [],
            answers,
            source: "swot-app",
          }, env)
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
