# prompts/

```
STATUS: REFERENCE SPECIFICATIONS ONLY — NOT RUNTIME AUTHORITY

Nothing in this directory is imported or consumed by the Worker.
Editing these files does not change Solomon's production behavior.
```

## Production authority

Production prompt behavior lives in:

**`worker/src/index.js`**

- `ASSESSMENT_RUBRIC`
- `TIER_GUIDE.free`
- `TIER_GUIDE.paid_47`
- `TIER_GUIDE.paid_297`
- `buildPrompt()`

BGA Copilot prompts live under:

**`worker/src/bga_copilot/`**

The structured output schema and report renderer also materially affect what the customer receives.

## Files in this directory

- [`UNIVERSAL_RUBRIC_RUNTIME_SPEC.md`](./UNIVERSAL_RUBRIC_RUNTIME_SPEC.md) — product ladder, shared financial capabilities, Miguel / Solomon identity, anti-withholding rules.
- [`FREE_TIER_RUNTIME_SPEC.md`](./FREE_TIER_RUNTIME_SPEC.md) — Business Health Check behavior.
- [`PAID_47_RUNTIME_SPEC.md`](./PAID_47_RUNTIME_SPEC.md) — $47 Full Diagnostic behavior, output contract, quality gate, deterministic math.
- [`STRATEGIST_REVIEW_SPEC.md`](./STRATEGIST_REVIEW_SPEC.md) — internal 30-minute strategist review prompt.
- [`PAID_297_RUNTIME_SPEC.md`](./PAID_297_RUNTIME_SPEC.md) — Business Growth Analysis Part 1 (the live paid_297 report).
- [`BGA_COPILOT_RUNTIME_SPEC.md`](./BGA_COPILOT_RUNTIME_SPEC.md) — internal roadmap, 50-minute call, post-call final plan.
- [`SERVICE_RECOMMENDATION_SPEC.md`](./SERVICE_RECOMMENDATION_SPEC.md) — service-match philosophy.

## Product ladder

Business Health Check → $47 Full Diagnostic → included 30-minute strategist review → $297 Business Growth Analysis → Premium CFO Bundle Service / appropriate CFO By Design solutions.

## Purpose of this directory

These files are readable specifications of the intended runtime behavior.

They exist to help developers, QA, strategists, and product owners understand:

- what each tier is supposed to accomplish,
- how value should increase through the funnel,
- where each tier should stop,
- and what the legitimate next step is.

They are **NOT editable production prompts**.

## Important

- Do not document hard-coded line numbers here.
- Do not treat version numbers written in this directory as authoritative. For current production versions, inspect the runtime constants in code.
- Do not create standalone prompt Markdown files and assume Solomon will use them.
- When a reference spec and production code disagree, production code is the current behavior and the discrepancy should be treated as documentation drift requiring review.

## Naming

Customer-facing:

- Business Health Check
- $47 Full Diagnostic
- Business Growth Analysis
- Premium CFO Bundle Service
- CFO By Design
- Solomon

Internal technical names may remain unchanged unless intentionally migrated.
