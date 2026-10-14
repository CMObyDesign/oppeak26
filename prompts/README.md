# prompts/

**Status: REFERENCE ONLY — NOT WIRED INTO RUNTIME.**

The files in this directory are early-draft prompt documents preserved
for reference. They are **not imported, read, or otherwise consumed by
the Worker at runtime**. Editing a file here does not change what
Solomon sees in production.

## Where the production prompts actually live

- Free, $47, and $297/BGA tier prompts are all built inline inside
  `worker/src/index.js`:
    - `ASSESSMENT_RUBRIC` string constant (around line 129) —
      the universal rubric header, carries `RUBRIC_VERSION = "r3.0"`
    - `TIER_GUIDE[tier]` object (around line 611) —
      per-tier instructions (free / paid_47 / paid_297)
    - `buildPrompt(tier, answers, ...)` function (around line 668) —
      assembles the final USER message passed to Claude; carries
      `PROMPT_VERSION = "p2.2"`
- The BGA Copilot strategist-facing prompts (roadmap draft, prep
  brief, challenge, call-decisions, red-team QA) live in their
  respective modules under `worker/src/bga_copilot/*.js`.

## Why this directory still exists

Historical reference for the prompt structure the project started with.
Useful as a readable prose spec of the FREE tier format; the
`strategist_brief_prompt.md` doc describes the brief shape in prose.

## What was removed

Two files were pure placeholders (literal text:
`"Placeholder: attachment content ... was not available on disk in this
environment. Replace this file with the exact attached draft content."`)
and have been deleted:

- `paid_tier_prompt.md`
- `strategist_brief_deep_dive_prompt.md`

They had no content worth preserving and risked tricking a future editor
into believing they were authoritative.

## Known stale content in the files that remain

- `free_tier_prompt.md` says Solomon receives *"five free-tier answers"*
  — current production is **11 free-tier questions**
  (`app/src/data/freeAssessmentQuestions.ts`).
- `strategist_brief_prompt.md` still references *"Bridge to $297 Deep
  Dive Audit"* — the public product name has been
  **Business Growth Analysis** since
  `docs/brand/PRODUCT_NAMING_AND_LADDER.md` retired "Deep Dive".

These will stay stale until a future effort re-syncs this directory
against the live `worker/src/index.js` prompts, or decides to delete
it outright. Neither affects production.
