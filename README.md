# CFO By Design — Tiered SWOT Assessment Funnel

This project powers a two-tier diagnostic funnel for CFO By Design, a fractional CFO brand serving businesses above $2M in revenue. It scores assessment responses, assigns a diagnostic path, generates AI-ready briefing context, and scaffolds a Cloudflare Worker integration to process webhook submissions and push outputs into downstream systems.

## Folder Structure

- `logic/question_mapping.json` — source-of-truth question and threshold configuration (existing file, not overwritten).
- `logic/scoring_logic.js` — scoring engine, path routing, tier detection, and AI context extraction.
- `logic/scoring_logic.test.js` — Node built-in tests validating routing, thresholds, and context extraction.
- `prompts/free_tier_prompt.md` — system prompt for the 5-question free diagnostic report.
- `prompts/paid_tier_prompt.md` — system prompt for the 14-question paid diagnostic report.
- `prompts/strategist_brief_prompt.md` — internal strategist brief generator prompt.
- `worker/src/index.js` — Cloudflare Worker scaffold for webhook intake and orchestration.

## Setup

1. Clone the repository and enter it:
   - `git clone <repo-url>`
   - `cd oppeak26`
2. Install dependencies (if/when `package.json` is added):
   - `npm install`
3. Configure environment variables (Cloudflare Worker secrets or `.dev.vars`):
   - `CLAUDE_API_KEY`
   - `GHL_API_KEY`
   - `ZOHO_API_KEY`

## Run Scoring Logic Tests

Use Node’s built-in test runner:

```bash
node --test logic/scoring_logic.test.js
```

## Deploy Cloudflare Worker

1. Ensure Wrangler is installed and authenticated.
2. Configure `wrangler.toml` for this project.
3. Deploy:

```bash
npx wrangler deploy
```

## Diagnostic Paths

- **CRITICAL_EXPOSURE** — foundational financial risk is high and immediate stabilization is needed.
- **HIDDEN_LIABILITY** — operations appear stable, but unresolved structural gaps are limiting financing leverage.
- **UNTAPPED_CAPACITY** — fundamentals are comparatively strong, with room to optimize growth and capital strategy.
- **REHAB_REQUIRED** — forced routing path triggered by a critical risk response (Q11_D), regardless of total score.

## Maintainer

Spark Agency — hello@glassdoormarketing.com
