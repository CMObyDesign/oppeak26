# CFO By Design — Tiered SWOT Assessment Funnel

This project powers a two-tier diagnostic funnel for CFO By Design, a fractional CFO brand serving businesses above $2M in revenue. It scores assessment responses, assigns a diagnostic path, generates AI-ready briefing context, and scaffolds a Cloudflare Worker integration to process webhook submissions and push outputs into downstream systems.

## Folder Structure

```text
oppeak26/
├── logic/
│   ├── question_mapping.json   — 14 questions, scoring config,
│   │                             path thresholds
│   ├── scoring_logic.js        — scoring engine, path assignment
│   └── scoring_logic.test.js   — test suite
├── prompts/
│   ├── free_tier_prompt.md     — AI prompt for free 5-question
│   │                             results page
│   ├── paid_tier_prompt.md     — AI prompt for $47 full
│   │                             diagnostic PDF report
│   ├── strategist_brief_prompt.md       — internal brief for
│   │                                      $47 pre-call prep
│   └── strategist_brief_deep_dive_prompt.md — internal brief
│                                              for $297 session prep
├── skills/
│   ├── gbp-competitor-audit/
│   │   └── SKILL.md            — GBP audit skill for local
│   │                             financial service clients
│   └── review-response-reputation/
│       └── SKILL.md            — FTC-compliant review response
│                                 and reputation program
├── worker/
│   └── src/
│       └── index.js            — Cloudflare Worker scaffold,
│                                 three-tier orchestration
└── README.md
```

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

## Three Diagnostic Paths

- **CRITICAL_EXPOSURE** (free: 5-12 / full: 14-28)
- **HIDDEN_LIABILITY** (free: 13-18 / full: 29-41)
- **UNTAPPED_CAPACITY** (free: 19-25 / full: 42-54)
- **REHAB_REQUIRED** (triggered by Q11_D regardless of score)

## Maintainer

Spark Agency — hello@glassdoormarketing.com
