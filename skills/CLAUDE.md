# CFO ByDesign Skills

> **Status: DESIGNED / DOCUMENTED / NOT YET WIRED INTO RUNTIME.**
>
> The phrase *"Skills the Solomon SWOT Engine loads"* below describes
> the **intended** Phase-2 architecture — not the current state.
> Nothing in `worker/src/` imports or references `skills/*`. The
> Solomon prompt built by `worker/src/index.js:buildPrompt()` does not
> read these files; the "When to load which skill by SWOT path" and
> "Skill graph" sections below do not fire automatically in production.
>
> Each file here is a **workflow specification** the strategist (or a
> future automated loader) is expected to follow — not a function that
> runs on its own today.
>
> The equivalent live tooling is in `worker/src/bga_copilot/*` (every
> module has its own test file): document extraction, verified-
> financial writes, roadmap generation, service matching, prep brief,
> challenge, call-decisions extraction, pre-send QA, and
> approve-and-send. Those ARE wired into the Worker.

---

Skills the Solomon SWOT Engine [will load, once Phase 2 wires them in] to produce CFO-grade outputs. Each skill is a workflow contract: when to load, what to ask for, how to act, what to return.

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

> **Note:** Every "load" / "determines which skills auto-load" / "runs
> alongside" claim in this section describes Phase-2 intent, not what
> runs today. The current Worker does not import or reference any file
> under `skills/*`.

- Worker: `worker/src/index.js` — Solomon backend. [Phase 2 plan: load
  relevant skills based on SWOT path.] Current state: `buildPrompt()`
  does not read anything from this folder.
- Prompts: `prompts/*.md` — reference-only drafts, not wired into the
  Worker (see `prompts/README.md`). Production tier prompts are built
  inline in `worker/src/index.js` via `ASSESSMENT_RUBRIC`, `TIER_GUIDE`,
  and `buildPrompt()`.
- Logic: `logic/scoring_logic.js` — orphaned pre-LLM scoring scaffold,
  not wired into the Worker (see `logic/README.md`). Scoring now runs
  inside Solomon per the `ASSESSMENT_RUBRIC`.

---

## Other skills in this folder

This `skills/` folder also contains:

- [`taste-skill/`](taste-skill/SKILL.md) — `design-taste-frontend`.
  [Phase 2 plan: loaded when generating reports and visual deliverables
  so output stays on-brand.] Not currently invoked by the Worker's
  report-render path. Treat as design-system reference for a human
  reviewer today.
- [`review-response-reputation/`](review-response-reputation/SKILL.md)
  — placeholder skill (separate workstream, pre-dates the CFO toolkit).

The 7 CFO skills above are the designed analyst toolkit for the SWOT
Engine; the `taste-skill` is the visual/design counterpart. Neither
group fires automatically from the Worker today — the "runs alongside"
and "loaded when" phrasing describes the Phase-2 target, not the
current runtime.

For the shipped equivalent tooling (deterministic service matching,
roadmap generation, document extraction, pre-send QA, approve-and-send,
etc.), see `worker/src/bga_copilot/*` — each module there is wired into
the Worker and has its own test file.

---

**Drafted:** 2026-06-22 · **CFO Skills count:** 7 (Phase 1 contracts) · **Status:** Phase-1 specifications (contracts drafted; Phase-2 runtime integration not yet built)
