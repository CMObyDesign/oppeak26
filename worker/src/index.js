/**
 * Data flow:
 * GHL webhook → tier determination → score calculation → prompt selection → Claude API → report generation →
 * GHL custom field update → Zoho CRM sync
 *
 * Tiers:
 * - free: free_tier_prompt.md → on-screen results + email
 * - paid_47: paid_tier_prompt.md → PDF report + 30-min booking
 * - paid_297: strategist_brief_deep_dive_prompt.md → manual review + 50-min session booking
 */

import { calculateScore } from '../../logic/scoring_logic.js';

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const payload = await request.json();
    const answers = payload.answers || {};
    const contactData = payload.contactData || {};
    const contactId = payload.contactId || contactData.id;

    const tier = determineTier(payload);
    const promptFile = selectPrompt(tier);

    const questions = []; // TODO: load question mapping source
    const scoreResult = calculateScore(answers, questions);

    const prompt = buildPrompt(tier, answers, contactData);
    const claudeOutput = await callClaudeAPI(prompt, env.CLAUDE_API_KEY);

    if (tier === 'paid_47') {
      await generatePDF(claudeOutput, contactData);
    }

    await scheduleSession(tier, contactId);
    await updateGHL(contactId, { tier, promptFile, scoreResult, claudeOutput });
    await updateZohoCRM(contactId, { tier, promptFile, scoreResult, claudeOutput });

    return Response.json({ ok: true, tier, promptFile, scoreResult });
  }
};

function determineTier(_payload) {
  // TODO: return "free" | "paid_47" | "paid_297" based on intake/payment metadata.
}

function selectPrompt(_tier) {
  // TODO: map tier to prompt file:
  // - free -> free_tier_prompt.md
  // - paid_47 -> paid_tier_prompt.md
  // - paid_297 -> strategist_brief_deep_dive_prompt.md
}

function buildPrompt(_tier, _answers, _contactData) {
  // TODO: load selected prompt template and construct the full prompt string with answers/contact context.
}

async function callClaudeAPI(_prompt) {
  // TODO: call Claude with the fully constructed prompt and return model output.
}

async function generatePDF(_claudeOutput, _contactData) {
  // TODO: generate $47 diagnostic PDF report from Claude output and contact data.
}

async function scheduleSession(_tier, _contactId) {
  // TODO: route to the correct booking link based on tier (30-min for paid_47, 50-min for paid_297).
}

async function updateGHL(_contactId, _data) {
  // TODO: update GHL custom fields for this contact with tier, score, and report metadata.
}

async function updateZohoCRM(_contactId, _data) {
  // TODO: sync tier outcome, scoring summary, and report metadata to Zoho CRM.
}
