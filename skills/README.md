# CFO ByDesign Skills

7 CFO-specific skills the Solomon SWOT Engine loads to produce CFO-grade outputs. Each skill is a workflow contract — when to load, what to ask for, how to act, what to return.

Mirrors the SKILL-AUTHORING-STANDARD pattern from the parent Spark Operations skills library.

**Shipped:** 2026-06-22 (Phase 1 — contracts only; Python tools and references in Phase 2)

## The 7 Skills

| # | Skill | What it does | Primary consumer |
|---|---|---|---|
| 1 | [financial-statement-analyzer](financial-statement-analyzer/SKILL.md) | Parse P&L / BS / cash flow, flag anomalies, surface pre-call questions | Upstream of all others |
| 2 | [cash-flow-forecaster](cash-flow-forecaster/SKILL.md) | 13-week rolling forecasts, scenario stress tests, runway analysis | $297 deep dive + fractional CFO retainers |
| 3 | [debt-restructure-analyzer](debt-restructure-analyzer/SKILL.md) | Map debt stack, rank by economic damage, recommend restructure path | MCA-stacked clients, workout situations |
| 4 | [tax-resolution-intake](tax-resolution-intake/SKILL.md) | Structured intake for IRS / state tax liabilities, severity triage, EA / attorney handoff packet | Any TAX_RESOLUTION_OPP flag from SWOT |
| 5 | [industry-benchmarker](industry-benchmarker/SKILL.md) | Compare client metrics to peer NAICS + revenue band benchmarks (RMA, IRS SOI, BizMiner) | Interpretation layer for the above |
| 6 | [proposal-drafter](proposal-drafter/SKILL.md) | Miguel-voice proposals — fractional retainers + project scopes — story-first, voice-checked | SWOT follow-on, cold discovery follow-on |
| 7 | [meeting-notes-extractor](meeting-notes-extractor/SKILL.md) | Transcripts → action lists, decisions, verbatim quote pack, CFO-side flag scan | Every client conversation |

## Skill graph

```
                meeting-notes-extractor
                          │
                          ▼
              financial-statement-analyzer
                ┌──────────┼──────────┐
                ▼          ▼          ▼
        cash-flow-      debt-      tax-resolution-
        forecaster   restructure-     intake
                      analyzer
                ┌──────────┼──────────┐
                ▼          ▼          ▼
              industry-benchmarker
                          │
                          ▼
                  proposal-drafter
```

## What's intentionally NOT in these drafts (deferred to Phase 2)

- Python scripts (`scripts/` folders) — these are spec-only; tools come next
- Knowledge base references (`references/` folders) — RMA tables, IRS letter-code catalog, NAICS-to-benchmark maps
- Templates (`templates/` folders) — proposal templates, intake forms, hand-off packets
- Cross-reference into `.claude-plugin/marketplace.json` and `.codex/skills-index.json`

Each skill's SKILL.md is the workflow contract. Phase 2 builds the supporting infrastructure once the contracts are approved.

## Voice & opinionation notes (worth a re-read before approving)

- All skills carry an opinionated practitioner voice. They tell you what to do, not what's available.
- Several skills have **hard rules** (tax-resolution refuses to advise on representation; industry-benchmarker refuses to invent benchmarks; proposal-drafter bans 5 buzzwords). These create teeth — agents that load them will refuse to violate the rule.
- All skills lead with "Bottom line first" communication and confidence tagging (🟢/🟡/🔴).

## Roadmap

**Phase 1 (this folder, shipped 2026-06-22):** 7 SKILL.md contracts + folder-level CLAUDE.md index.

**Phase 2 (next):**
1. Wire the Solomon backend (`worker/src/index.js`) to load relevant skills based on SWOT path — see `CLAUDE.md` for the path → skills map.
2. Build Python scripts in priority order: `cash-flow-forecaster` → `proposal-drafter` → `financial-statement-analyzer` first.
3. Build knowledge bases (`references/`): RMA ratio tables, IRS letter-code catalog, NAICS-to-benchmark maps, debt-instrument glossary.
4. Build templates (`templates/`): proposal opener templates, intake forms, hand-off packets.
5. Build `cfobd-client-context.md` per-engagement context-file pattern per the SKILL-AUTHORING-STANDARD.

**Phase 3 (later):** Consultant-facing Solomon console at `solomon-console.cfobydesign.workers.dev` (CF Pages + CF Access auth) where Miguel's team can QA outputs, replay prompts, and approve reports before client send.
