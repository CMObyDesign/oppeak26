# CFO ByDesign Skills

Skills the Solomon SWOT Engine loads to produce CFO-grade outputs. Each skill is a workflow contract: when to load, what to ask for, how to act, what to return.

## When to load which skill by SWOT path

| Path | Default skills loaded |
|---|---|
| `rehab` | debt-restructure-analyzer, tax-resolution-intake, cash-flow-forecaster, financial-statement-analyzer |
| `urgent` | cash-flow-forecaster, debt-restructure-analyzer, financial-statement-analyzer |
| `growth` | cash-flow-forecaster, industry-benchmarker, proposal-drafter, financial-statement-analyzer |
| `strong` | industry-benchmarker, financial-statement-analyzer, proposal-drafter |

**Universal triggers** — load when their conditions fire regardless of path:
- `meeting-notes-extractor` — any time a call transcript is processed
- `financial-statement-analyzer` — any time raw financials enter the system

## Skill index

| Skill | What it does | Phase |
|---|---|---|
| [financial-statement-analyzer](financial-statement-analyzer/SKILL.md) | Parse / validate / anomaly-flag P&L, BS, cash flow before any forecasting | 1 |
| [cash-flow-forecaster](cash-flow-forecaster/SKILL.md) | 13-week rolling forecasts, scenario stress tests, runway analysis | 1 |
| [debt-restructure-analyzer](debt-restructure-analyzer/SKILL.md) | MCA payoff, SBA refi, workout sequencing — leads with effective APR | 1 |
| [tax-resolution-intake](tax-resolution-intake/SKILL.md) | Structured intake for IRS / state tax liabilities — refers to EA / tax attorney | 1 |
| [industry-benchmarker](industry-benchmarker/SKILL.md) | RMA / IRS SOI / BizMiner peer comparisons — refuses to invent benchmarks | 1 |
| [proposal-drafter](proposal-drafter/SKILL.md) | Miguel-voice proposals — story-first, banned-word list, Liz-approval gate | 1 |
| [meeting-notes-extractor](meeting-notes-extractor/SKILL.md) | Transcripts → actions, decisions, verbatim quote pack, CFO flag scan | 1 |

## Skill graph

```
        meeting-notes-extractor
                  │
                  ▼
      financial-statement-analyzer
        ┌──────────┼──────────┐
        ▼          ▼          ▼
cash-flow-     debt-     tax-resolution-
forecaster  restructure-    intake
              analyzer
        ┌──────────┼──────────┐
        ▼          ▼          ▼
      industry-benchmarker
                  │
                  ▼
          proposal-drafter
```

## Quality standard

All skills follow the [SKILL-AUTHORING-STANDARD](https://github.com/AlirezaRezvani/claude-skills) pattern:

- Practitioner voice (expert persona + clear goal)
- Multi-mode workflows (build / optimize / situation-specific)
- Proactive triggers (4-6 per skill)
- Output artifacts table (4-6 per skill)
- Bottom-line-first communication
- Confidence tagging: 🟢 verified / 🟡 medium / 🔴 assumed
- Related Skills section with WHEN / NOT-WHEN disambiguation

## Hard rules baked into individual skills

- **tax-resolution-intake**: never advises on representation, OIC eligibility math, audit defense, or installment-agreement terms. Refers to licensed EA / CPA / tax attorney for all resolution work.
- **industry-benchmarker**: never invents benchmark numbers. If no defensible RMA / IRS SOI / BizMiner cite exists, says so.
- **proposal-drafter**: bans buzzwords (synergy/leverage/unlock/robust/seamless). Hard gates on Liz review before any client send.
- **debt-restructure-analyzer**: leads with effective APR, not monthly payment. Refuses to recommend a refi that doesn't beat status quo math.

## Phase 2 — deferred infrastructure

These come AFTER the SKILL.md contracts are stable and the Solomon console is live:

- Python scripts (`scripts/`) — stdlib-only, CLI-first, 0-100 scoring, JSON + human output
- Knowledge bases (`references/`) — RMA ratio tables, IRS letter-code catalog, NAICS-to-benchmark maps, debt-instrument glossary
- Templates (`templates/`) — proposal opener templates, intake form templates, hand-off packet templates
- Domain context file (`cfobd-client-context.md`) — created via guided interview per the SKILL-AUTHORING-STANDARD context-first pattern

## Related (outside this folder)

- Worker: `worker/src/index.js` — Solomon backend; loads relevant skills based on SWOT path
- Prompts: `prompts/*.md` — free / paid_47 / paid_297 generation prompts; skills supplement, not replace
- Logic: `logic/scoring_logic.js` — path scoring; determines which skills auto-load

---

## Other skills in this folder

This `skills/` folder also contains:

- [`taste-skill/`](taste-skill/SKILL.md) — `design-taste-frontend`. **Part of the Solomon ecosystem** — loaded when generating reports and visual deliverables so output stays on-brand and visually tasteful. Pair with `proposal-drafter` and the worker's `buildReportHtml` / `buildReportPage` rendering.
- [`review-response-reputation/`](review-response-reputation/SKILL.md) — placeholder skill (separate workstream, pre-dates the CFO toolkit).

The 7 CFO skills above form the coordinated analyst toolkit for the SWOT Engine. The `taste-skill` is the visual/design counterpart that runs alongside them.

---

**Drafted:** 2026-06-22 · **CFO Skills count:** 7 (Phase 1 contracts) · **Status:** Production-ready spec
