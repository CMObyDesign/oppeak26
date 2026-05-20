/**
 * Data flow:
 * GHL webhook -> tier determination -> score calculation -> prompt selection
 * -> Claude API -> GHL custom field update -> Zoho CRM sync
 */

import { calculateScore } from '../../logic/scoring_logic.js';

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const payload = await request.json();

    const tier = determineTier(payload);
    const questions = []; // TODO: load question mapping source
    const answers = payload.answers || {};

    const scoreResult = calculateScore(answers, questions);
    const prompt = buildPrompt(tier, scoreResult, payload);
    const aiResult = await callClaudeAPI(prompt, env.CLAUDE_API_KEY);

    await updateGHL(payload, aiResult, env.GHL_API_KEY);
    await updateZohoCRM(payload, scoreResult, aiResult, env.ZOHO_API_KEY);

    return Response.json({ ok: true, tier, scoreResult });
  }
};

function determineTier(_payload) {
  // TODO: inspect incoming answers and decide free vs full
}

function buildPrompt(_tier, _scoreResult, _payload) {
  // TODO: select and hydrate free_tier_prompt or paid_tier_prompt
}

async function callClaudeAPI(_prompt, _apiKey) {
  // TODO: invoke Claude API using CLAUDE_API_KEY
}

async function updateGHL(_payload, _aiResult, _apiKey) {
  // TODO: update GHL custom fields using GHL_API_KEY
}

async function updateZohoCRM(_payload, _scoreResult, _aiResult, _apiKey) {
  // TODO: sync outcome to Zoho CRM using ZOHO_API_KEY
}
