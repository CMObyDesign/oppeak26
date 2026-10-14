# logic/

**Status: SCAFFOLD — ORPHANED, NOT WIRED INTO RUNTIME.**

The files in this directory are an early scoring-engine scaffold that
was **never wired into the production Worker**. Nothing in
`worker/src/` or `app/src/` imports from `logic/`. The only reference
to `scoring_logic.js` anywhere in the codebase is its own test file,
which exercises code nothing else uses.

## Where production scoring actually lives

- Tier detection, path routing, and the free/full assessment thresholds
  are inlined in `worker/src/index.js`:
    - `ASSESSMENT_RUBRIC` describes the scoring rules Solomon applies
    - `TIER_GUIDE[tier]` carries the per-tier instructions
    - Classification into `growth` / `needs-attention` / `rehab` is
      performed by Solomon per the rubric, not by a client-side scorer
- The intake questions themselves and their `fieldKey` → GHL custom-
  field mapping live in `app/src/data/{free,paid}*.ts`.

## Why this directory still exists

Historical reference for the originally-planned pre-LLM scoring model
(thresholds like `CRITICAL_EXPOSURE { min: 5, max: 12 }` for the free
tier, `CRITICAL_EXPOSURE { min: 14, max: 28 }` for the full
assessment). The LLM-driven approach superseded it before the scaffold
was wired up.

## Should I delete it?

No current import path breaks if `logic/` is removed, including its
test file. It's preserved as a reference for how the scoring was
originally conceived in case anyone revisits a deterministic
pre-classifier in front of Solomon. If that never happens, this
directory can be deleted in a future cleanup.

**Do not add new code here** unless the plan is to wire it in. New
scoring/routing logic belongs in `worker/src/` so Solomon or the
report-render path can consume it.
