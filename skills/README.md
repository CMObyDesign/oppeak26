# CFO By Design · Solomon Skills

```
REFERENCE SPEC ONLY — NOT RUNTIME AUTHORITY

Nothing under /skills/ is currently imported, loaded, read, or executed by
the Worker.

Editing a SKILL.md file does not change Solomon's production behavior.

Production financial reasoning currently comes from:
- ASSESSMENT_RUBRIC
- TIER_GUIDE
- buildPrompt()
- deterministic facts / derived metrics
- structured output schema / renderer
- worker/src/bga_copilot/* for BGA orchestration
```

## Intended Future Architecture

Skills are reusable CFO capabilities, not product tiers.

The same financial capability may be available at different levels of depth depending on the product tier.

Tier policy controls:

- whether the capability may be invoked,
- which inputs it may use,
- the depth of analysis allowed,
- whether verification is required,
- and what output it may produce.

## Intended Access Matrix

```
Capability                     Free              $47               BGA
cash-flow-forecaster            signal_only       diagnose          verified_planning
debt-restructure-analyzer       signal_only       diagnose          sequence/recommend
financial-statement-analyzer    disabled          docs_if_present   verified_analysis
industry-benchmarker            limited           diagnose          strategic_analysis
tax-resolution-intake           signal_only       diagnose          sequence/service_fit
meeting-notes-extractor         disabled          disabled          enabled
proposal-drafter                disabled          disabled          strategist_only
review-response-reputation      outside_core      outside_core      outside_core
taste-skill                     experimental      experimental      experimental
```

## Important

This matrix is **policy design only** until a production loader and enforcement layer are implemented.

See [`/prompts/UNIVERSAL_RUBRIC_RUNTIME_SPEC.md`](../prompts/UNIVERSAL_RUBRIC_RUNTIME_SPEC.md) for the "shared skills + BGA orchestration" philosophy that governs how tier policy should eventually gate these capabilities.

See [`worker/src/bga_copilot/`](../worker/src/bga_copilot/) for the equivalent shipped tooling — deterministic modules with their own test files that cover the BGA-specific workflow (document extraction, verified-financial writes, roadmap generation, service matching, prep brief, challenge, call-decisions extraction, pre-send QA, and approve-and-send).
