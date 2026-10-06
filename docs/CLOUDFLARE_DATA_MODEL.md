# Cloudflare Data Model — D1 canonical store

Companion to `docs/SOLOMON_ARCHITECTURE.md`. The contracts live there;
this file documents **what** lives in D1, **why**, and **how** to wire the
database up.

## Status

| Phase | What it does | State |
|---|---|---|
| 1a | Schema + migration + data-access module | shipped |
| 1b | Dual-write from `handleGHLSurveyWebhook` and `handleConsoleRun`, R2 HTML artifact | shipped |
| 1c | `/report/{contactId}` reads D1 with GHL fallback; `?v=N` / `?report_id=` history | shipped |
| 2a | Deterministic normalization — populates `normalized_answers_json` | shipped |
| 2b | Deterministic derived-metrics engine — populates `derived_metrics_json` | shipped |
| 2c | Structured findings schema + evidence-backed validation | shipped |
| 2d | Report renderer consumes structured findings | shipped |
| 3a | Strategist feedback capture (capture-only, no auto-learning) | shipped |
| 3b | Strategist review UI (reads + writes against the 3A endpoints) | shipped |
| **3c** | Rule-promotion review queue inside Ask Solomon (human-gated) | **shipped (this change)** |

Phase 1c is **safe to ship before the D1 and R2 bindings are wired**.
The default `/report/{contactId}` read tries D1 first and falls through
to the pre-existing GHL custom-field read whenever D1 is empty, missing,
or has no row for the contact — so every pre-canonical contact keeps
working. Historical reads (`?v=N`, `?report_id=`) are D1-only; without
the binding they return 404 (the architecture forbids reconstructing
history from the owner's current GHL fields).

Dry runs (`body.dry_run: true`) still never land in canonical history —
that short-circuit is in `writeCanonicalRecord` from Phase 1b and
nothing in Phase 1c reads during a dry run.

## One-time setup

Run these from a shell with Cloudflare auth (`wrangler login` or `CLOUDFLARE_API_TOKEN`):

```bash
# 1. Create the D1 database. Prints a database_id — save it.
wrangler d1 create solomon-canonical

# 2. Uncomment the [[d1_databases]] block in wrangler.toml and paste
#    the printed database_id into the `database_id =` line.

# 3. Apply the initial schema to the remote database.
wrangler d1 migrations apply solomon-canonical --remote

# 4. Create the R2 bucket for rendered-HTML artifacts (Phase 1b).
wrangler r2 bucket create solomon-reports

# 5. Uncomment the [[r2_buckets]] SOLOMON_REPORTS block in wrangler.toml.

# 6. Deploy the worker so both bindings take effect.
wrangler deploy
```

After deploy, submissions and reports start landing in D1 on every
real (non-dry-run) generation; rendered HTML lands in R2 under
`reports/{contact_id}/{report_id}/report.html`. HighLevel `swot_*` fields
continue to carry the latest customer-facing projection as before — the
read path doesn't change until Phase 1c.

For local development against a sqlite shim:

```bash
wrangler d1 migrations apply solomon-canonical --local
wrangler dev
```

## Schema

Three tables. Full SQL in `worker/migrations/0001_initial_schema.sql`.

### `submissions`

One row per intake. The whole-answer snapshot lives here — later edits to
the owner's current GHL fields never mutate historical rows. This is what
makes `/report/{contactId}?v=1` honest years later.

Primary idempotency guard: `UNIQUE(source_event_id, tier, assessment_version)`
replaces the short-TTL `reserveIdempotency` as the durable duplicate
protection. A webhook retry carrying the same `source_event_id` surfaces as
`{ok: false, duplicate: true}` from `insertSubmission`.

Key columns:

| column | meaning |
|---|---|
| `id` | UUID (submission_id) |
| `contact_id` | GHL contact id |
| `tier` | `free` / `paid_47` / `paid_297` |
| `source_event_id` | GHL webhook id or request id — the idempotency key |
| `raw_answers_json` | the complete answer snapshot used for this generation |
| `normalized_answers_json` | populated in Phase 2 (normalization layer) |
| `derived_metrics_json` | populated in Phase 2 (code-side math) |
| `validation_json` | `{complete, missing_fields, warnings}` |
| `status` | `ready` / `incomplete` / `failed` |

### `report_versions`

One row per Solomon generation. Reports are immutable; a regeneration
inserts a new row with `report_version = N+1`. Version N stays reachable
at `/report/{contactId}?v=N`.

Key columns:

| column | meaning |
|---|---|
| `id` | UUID (report_id) |
| `submission_id` | FK to `submissions.id` |
| `contact_id` | denormalized for `/report` lookups |
| `report_version` | 1, 2, 3 … per submission (UNIQUE within submission) |
| `classification` | `growth` / `needs-attention` / `rehab` |
| `diagnostic_json` | the full agent object (findings, opportunities, …) |
| `strategist_brief_json` | internal-only brief — contains customer analysis |
| `prompt_version`, `rubric_version`, `model_version`, `code_version` | provenance stack per the architecture doc |
| `r2_html_key`, `r2_html_bytes`, `r2_html_sha256` | R2 artifact reference (populated in Phase 1d) |
| `is_successful` | `0` for failed generations retained for audit |

Indexes on `(contact_id, is_successful, created_at DESC)` for the
latest-successful lookup, and on `(submission_id, report_version)` for
historical reads.

### `ghl_sync`

One row per writeback attempt. If HighLevel is unavailable, the generated
report is never lost — `report_versions` already has it. `ghl_sync` marks
the projection as `pending` / `succeeded` / `failed` and gives retry
metadata (`attempt_count`, `last_error`, `last_attempt_at`).

Design note: this is an append-only log, not a mutable state row. The
latest row per `report_id` is the current state; `(report_id, last_attempt_at DESC)`
is the index that serves it. Pending/failed rows can be queried via the
partial index `WHERE status != 'succeeded'`.

## Interaction with HighLevel

Per the HighLevel latest-state contract in `SOLOMON_ARCHITECTURE.md`,
GHL's `swot_*` custom fields are the operational projection, not the
system of record. The dual-write flow in Phase 1b is:

```
intake → Solomon runs → insert submissions row
                     → insert report_versions row (version N+1)
                     → write HTML to R2, update report_versions.r2_html_key
                     → update HighLevel swot_* fields (projection)
                     → insert ghl_sync row (succeeded or failed)
```

If any step after `insert report_versions` fails, the canonical record
survives. The projection can be retried.

Historical reports (`?v=N`, `?report_id=UUID`) must resolve from the stored
D1 snapshot. **Never** reconstruct a historical report from the owner's
current GHL fields — that would quietly rewrite history.

## Backfill is not required

The architecture is additive. Old submissions that live only in GHL stay
reachable via the current `/report/{contactId}` path (GHL custom-field
read). Once Phase 1c lands, that handler reads from D1 first and falls
back to GHL for contacts without a D1 row — new submissions become
canonical immediately, old ones remain reachable.

## Reading history

Live as of Phase 1c:

| URL | Resolves to | Source |
|---|---|---|
| `/report/{contactId}` | latest successful report (same as HighLevel's current `swot_full_report`) | D1 latest → GHL fallback |
| `/report/{contactId}?v=2` | report_version 2 for that contact's latest submission chain | D1 only |
| `/report/{contactId}?report_id=<uuid>` | that specific report row | D1 only |
| `/report/{contactId}?include=failed` | internal-only; audit view | reserved, not yet implemented |

**HTML source for a resolved D1 row:** R2 artifact first; else re-render
from the stored `diagnostic_json` with `buildReportHtml`. This covers two
real cases: rows written before R2 was wired, and rows whose R2 artifact
was deleted. The diagnostic JSON is canonical; R2 is just a cache.

**Historical URLs do not fall back to GHL.** A `?v=N` or `?report_id=`
request returns 404 if the D1 row is missing. The architecture forbids
reconstructing a historical report from the owner's current GHL fields
(see `docs/SOLOMON_ARCHITECTURE.md` → Answer snapshot contract).

**Cross-contact safety:** `?report_id=<uuid>` checks that the stored
row's `contact_id` matches the URL path. A crafted URL that points at
another contact's report returns 404.

## Normalization (Phase 2A)

The deterministic normalizer in `worker/src/normalize.js` converts GHL
custom-field answers into typed values Phase 2B's derived-metrics engine
can consume. Rules:

- **Deterministic code only** — never a second LLM call.
- **Preserve the raw.** The whole-answer snapshot still lives in
  `raw_answers_json`; normalization produces the parallel
  `normalized_answers_json` entries.
- **Each GHL field id → stable `question_key`.** If GHL renames the
  field in the UI, the id stays and the question_key stays. The map
  is pinned to identity, not label (see `FIELD_NORMALIZERS`).
- **Ambiguous → `"unknown"`, missing → `null`.** Never fabricate a
  default. The invented-tax-lien bug (closed by PR #52) is also enforced
  at the normalizer layer: an explicit denial ("no judgments or liens")
  keeps `judgments_or_liens: false` even when the sentence contains the
  word "judgment".

Each entry in `normalized_answers_json` carries:

```json
{
  "source_field_id": "GGyFaucTwsIEsrXBHUsy",
  "question_key": "monthly_debt_service",
  "raw_question": "How much do you pay every month on servicing your corporate debt?",
  "raw_answer": "1800",
  "normalized_value": 1800
}
```

Normalized question keys currently in production (bump this list when
`FIELD_NORMALIZERS` gains an entry):

| question_key | tier | type |
|---|---|---|
| `business_type` | free | string |
| `customer_acquisition_channel` | free | string |
| `industry` | free | string |
| `active_debt_summary` | free | `{subtypes[], judgments_or_liens}` |
| `financial_decision_basis` | free | `bank_balance_heavy` / `actual_numbers` / `mixed` / `unknown` |
| `monthly_debt_service` | paid_47 | number (USD) |
| `total_corporate_debt` | paid_47 | number (USD) |
| `ar_60_plus` | paid_47 | number (USD) |
| `ar_30_plus` | paid_47 | number (USD) |
| `tax_returns_status` | paid_47 | `current` / `overdue` / `not_filed` / `on_payment_plan` / `lien` / `unknown` |
| `has_formal_audit` | paid_47 | boolean |
| `has_documented_budget` | paid_47 | boolean |
| `debt_status` | paid_47 | `current` / `stretched` / `delinquent` / `paid_off` / `unknown` |
| `merchant_processing_last_review` | paid_47 | 6 bucket enum |

Fields deliberately NOT normalized: competitors, bold move, best-margins,
proprietary process, where losing deals, financial metrics not tracked.
Those are long-form narrative; they stay in `raw_answers_json` and the
rubric still reads them as prose.

## Derived metrics (Phase 2B)

Code — not the LLM — computes every financial ratio Solomon cites.
`worker/src/derived.js` reads the flat normalized view and emits entries
to `derived_metrics_json`. Rules:

- **Only emit a metric when ALL required inputs are usable numbers.**
  Not `null`, not `undefined`, not the string `"unknown"`. If any input
  is missing or ambiguous, the metric does not appear.
- **Division-by-zero is a missing input.** If the denominator is zero
  (or negative), the metric does not appear.
- **Every emitted metric records its inputs.** The strategist must
  always be able to trace a number back to the answers that produced it.
- **Rounding is applied once at output** — 2 decimals for month-counts,
  4 for ratios, no rounding for dollar passthroughs.

Each entry:

```json
{
  "metric": "ar_60_plus_months_of_debt_service",
  "value": 3.61,
  "unit": "months",
  "inputs": [
    { "field": "ar_60_plus", "value": 6500 },
    { "field": "monthly_debt_service", "value": 1800 }
  ]
}
```

Currently computed metrics (bump this list when `derived.js` adds one):

| metric | unit | inputs |
|---|---|---|
| `total_debt` | dollars | `total_corporate_debt` |
| `monthly_debt_service_amount` | dollars | `monthly_debt_service` |
| `ar_30_plus_amount` | dollars | `ar_30_plus` |
| `ar_60_plus_amount` | dollars | `ar_60_plus` |
| `ar_30_plus_months_of_debt_service` | months | `ar_30_plus`, `monthly_debt_service` |
| `ar_60_plus_months_of_debt_service` | months | `ar_60_plus`, `monthly_debt_service` |
| `lead_to_booking_rate` | ratio | `leads_per_month`, `bookings_per_month` |
| `booking_to_show_rate` | ratio | `bookings_per_month`, `shows_per_month` |
| `show_to_offer_rate` | ratio | `shows_per_month`, `offers_per_month` |
| `offer_to_close_rate` | ratio | `offers_per_month`, `closes_per_month` |
| `lead_to_sale_rate` | ratio | `leads_per_month`, `closes_per_month` |

The five funnel-conversion rates do not fire against today's intake —
the GHL survey does not yet collect per-stage counts. The code is in
place for the day the normalizer adds `leads_per_month`,
`bookings_per_month`, `shows_per_month`, `offers_per_month`,
`closes_per_month`. The debt + A/R metrics fire on today's paid_47
intake exactly as spec'd.

Phase 2C will add structured findings that CITE these metrics by name,
giving each finding `derived_metrics: [{metric, value}]` provenance.

## Structured findings (Phase 2C)

The diagnosis becomes data; the wording stays presentation. Solomon now
emits an **additive** `structured_findings` array inside `diagnostic_json`
alongside the existing `gaps` / `opportunities` prose arrays. Each entry
names the specific intake fields it relies on and the deterministic
metrics it cites. The schema:

```json
{
  "finding_id": "ar-aging-001",
  "category": "cash_flow",
  "severity": "high",
  "evidence": [
    { "field": "ar_60_plus", "value": 6500 },
    { "field": "monthly_debt_service", "value": 1800 }
  ],
  "derived_metrics": [
    { "metric": "ar_60_plus_months_of_debt_service", "value": 3.61 }
  ],
  "interpretation": "Meaningfully aged receivables may be adding avoidable cash-flow pressure.",
  "recommendation": "Improve collection cadence before assuming additional expansion debt."
}
```

### Prompt-side wiring

When the submission has normalized + derived data available (the GHL
webhook path), `buildPrompt` injects two sections into the user message:

- `## FACTS` — the flat `question_key → value` object. Solomon's
  structured findings may cite ONLY keys from this object.
- `## DERIVED METRICS` — the Phase 2B metrics array. Solomon's
  structured findings may cite ONLY metric names from this list, with
  the same values; it must not reinvent a ratio the engine already
  computed.

When facts/derived are absent (console runs that didn't normalize),
both sections are omitted and Solomon falls back to prose-only output.
`structured_findings` is additive — the renderer continues to read the
prose arrays for Phase 2C.

### Validation (strict — any violation strips the finding)

The post-parse validator in `worker/src/findings.js`
(`validateStructuredFindings`) rejects any finding that:

1. Cites an `evidence.field` that is not a question_key in the
   normalized intake, or whose stored value is null.
2. Cites a primitive `evidence.value` that does not match the stored
   normalized value.
3. Cites a `derived_metrics.metric` that was not computed by the
   deterministic engine, or whose value differs by more than ±1%.
4. Has zero evidence AND zero derived_metrics (grounded in nothing).
5. Has empty `interpretation` or `recommendation`.
6. Has an invalid `severity` (must be `low` | `medium` | `high`).
7. Has an empty `finding_id` or `category`.

Invalid findings are logged with their rejection reasons and stripped
from `agent.structured_findings` before storage. The prose arrays
(`gaps`, `opportunities`) are untouched by this layer. This is the
exact PR #52 debt-subtype discipline played out at the structural
layer: a finding that would claim `tax_lien = true` without supporting
intake is rejected before it reaches the customer.

## Report renderer (Phase 2D)

`buildReportHtml` now consumes `structured_findings` when present and
renders each one into the existing Critical Gaps visual slot:

- `interpretation` → the top line (title).
- `recommendation` → the sub-line.
- `severity` → priority badge (`high` → HIGH red, `medium` → MEDIUM amber,
  `low` → LOW). The visual slot is identical to the pre-2D prose gap so
  nothing in the shell page or GHL contract shifts.
- Each finding renders a **"Based on:"** receipts footer carrying its
  evidence fields and derived metrics in human-friendly form —
  `A/R 60+ days: $6,500 · Monthly debt service: $1,800 · Months of debt
  service in 60+ A/R: 3.61 months`. This is the trust-building
  traceability the architecture asked for: a reader can see the exact
  intake + math each finding rests on.

**Fallback discipline.** When `agent.structured_findings` is empty or
absent, the renderer falls back to `agent.gaps` (prose) unchanged — so
pre-canonical generations and console runs that didn't produce
structured output keep working. The opportunities section is unchanged
in Phase 2D: it continues to render from `agent.opportunities` prose.

**Phase 2D also hardened the Phase 2C validator** against three Codex
P1 patterns the previous shape of the rules allowed through:

- A compound evidence value (e.g. `active_debt_summary = {subtypes,
  judgments_or_liens}`) with a cited property that doesn't match the
  stored object is REJECTED. Previously object-value comparison was
  skipped entirely — the exact PR #52 debt-subtype bug could have
  slipped back in via `{judgments_or_liens: true}` on a contact whose
  stored value was `false`.
- A numeric evidence value cited as a stringified amount (`"999999"`)
  is REJECTED. The output schema's quoted placeholder could encourage
  the model to emit strings; the validator now requires a finite
  number.
- A derived-metric citation with a stringified or missing `value` is
  REJECTED on the same basis.

And the sanitizer `sanitizeStructuredFindings` is now wired into
**every generation path** (`handleGHLSurveyWebhook`, `handleConsoleRun`,
and the public assessment POST), not just the webhook. Console runs
and public POSTs have no normalization context — the sanitizer runs
with an empty context so every structured finding fails the
grounded-in-nothing rule and is stripped, keeping unvalidated findings
out of returned HTML.

### Normalization fixes shipped alongside 2D

Phase 2A missed three production label patterns the renderer would
have exposed:

- `normTaxReturnsStatus`: `One or both years are not yet filed`
  (paid-tier survey option) collided with `\bfiled\b` and was
  returning `current` — now returns `not_filed`.
- `normFinancialDecisionBasis`: `I run on numbers I have clean
  financials` and `Somewhere in between` (free-tier survey options)
  were returning `unknown` — now return `actual_numbers` and `mixed`.
- `normDebtSummary`: bare `Yes` / `Not sure` (free-tier labels) were
  being collapsed to `{judgments_or_liens: false}` identical to `No`
  — now `Yes` and `Not sure` return `{judgments_or_liens: "unknown"}`
  so an affirmative or ambiguous answer isn't silently converted into
  a clean denial.

### Phase 1c follow-up (shipped alongside Phase 2)

Three Codex findings on the original Phase 1c PR, addressed in a
dedicated follow-up:

- **D1 before GHL.** `handleReport` now resolves D1 first on both the
  default and historical paths. GHL is consulted only for name/email
  on the shell page via `fetchGhlContactMetadata`, which returns
  `{ok:false, contact:null}` on any failure instead of propagating.
  A GHL outage or a deleted GHL contact can no longer block the
  canonical read of a report that lives safely in D1 + R2.

- **Stable `?v=N` semantics.** `writeCanonicalRecord` mints a fresh
  `submission_id` per generation, so a contact's free and paid chains
  both start at `report_version = 1`. The previous query ordered by
  `created_at DESC` and silently retargeted. The new
  `reportByVersion` first resolves `latestSubmissionIdForContact`,
  then queries `WHERE submission_id = ? AND report_version = ?`.
  `?v=N` now refers to the Nth report in the owner's **current** intake
  chain; cross-chain history is reachable via `?report_id=<uuid>` only.

- **`is_successful = 1` on historical reads.** Audited failed
  generations (`is_successful = 0`) retained for internal review
  now stay out of customer-facing URLs — both `reportById` and
  `reportByVersion` filter them out. The reserved `?include=failed`
  audit path will have its own query when built.

## Strategist feedback (Phase 3A)

Phase 3A is **capture-only**. The strategist attaches structured
feedback to any report (whole report) or any report + finding pair
(single finding). Nothing in this layer makes Solomon learn from
itself — rule promotion is a separate, human-gated step (Phase 3C)
that reads approved rows out of this table.

### `strategist_feedback`

One row per feedback item. Full SQL in
`worker/migrations/0002_strategist_feedback.sql`.

| Column | Why |
|---|---|
| `id` | UUID primary key. |
| `report_id` | FK to `report_versions.id` (the version being critiqued). |
| `submission_id` | Denormalized for queries that scope to one intake chain. |
| `contact_id` | Denormalized for the per-contact lifecycle view. |
| `finding_id` | Null for whole-report feedback; else a `structured_findings.finding_id`. |
| `feedback_type` | One of the 16 approved categories (below). |
| `original_output` | The sentence or finding that was wrong. |
| `strategist_revision` | What it should have said. |
| `reason` | The strategist's explanation. |
| `candidate_rule` | Proposed rubric rule, for Phase 3C review. |
| `approved_for_learning` | `0` on insert; flipped to `1` only by a human in Phase 3C. |
| `approved_by` / `approved_at` | Who approved it and when (null until approved). |
| `created_by` / `created_at` | Who filed the feedback and when. |

Indexes support three access patterns: fetch all feedback on a report
(strategist review UI), fetch all pending feedback of a given type
(rule-promotion queue), and fetch everything for one contact across
all of their reports (lifecycle view).

### `FEEDBACK_TYPES` vocabulary (§ 22)

Frozen in `worker/src/db.js` so a new category can be added without
a schema migration. If this list changes, update
`docs/SOLOMON_ARCHITECTURE.md` and the strategist review UI (Phase 3B)
in lockstep.

`factual_error`, `invented_fact`, `tier_leakage`, `causal_overreach`,
`severity_overstatement`, `severity_understatement`, `bad_calculation`,
`poor_personalization`, `weak_opportunity`, `generic_language`,
`incorrect_classification`, `financial_terminology`, `bad_cta`,
`missing_context`, `great_output`, `approved_example`.

### Endpoints

Both are CONSOLE_PASSWORD-gated — the same gate used by `/asksolomon/run`.

- `POST /feedback` — insert one feedback row. Rejects a missing
  `report_id` or an unknown `feedback_type` with a shape error. Returns
  `{skipped: true, reason: "no_db_binding"}` when D1 isn't wired, so
  the UI can degrade gracefully before Phase 3B goes live.
- `GET /feedback?report_id=<id>` — list all feedback on a report
  (strategist review UI), newest first.
- `GET /feedback?pending_type=<type>` — list pending (not yet approved)
  feedback for a given category, newest first. Used by the Phase 3C
  rule-promotion review queue.

### What Phase 3A is **not**

- Not auto-learning. `approved_for_learning` stays `0` on every row
  the API writes. A human toggles it in Phase 3C, bumps `rubric_version`,
  and re-runs the regression suite before anything in the generator
  reads from here.
- Not retroactive. Feedback is attached to the specific `report_id` it
  critiques. Earlier reports that would have failed the same category
  are not relabeled; they stay as they were generated.

## Strategist review UI (Phase 3B)

The strategist opens `/strategist`, pastes a `report_id`, and attaches
feedback to any structured finding on that report (or to the whole
report). Every save goes through the Phase 3A `POST /feedback`
endpoint, so the capture discipline is unchanged — Phase 3B is pure
UI on top of the existing contract.

### Endpoints

- `GET /strategist` — the review page itself. Static HTML, served to
  any browser; the API calls the page makes carry
  `x-console-password`, so authentication happens on the data path,
  not on the shell. The page bakes in the `FEEDBACK_TYPES`
  vocabulary from `worker/src/db.js` at request time so the
  dropdown and the server's accepted set can't drift.
- `GET /strategist/report/{reportId}` — JSON lookup backing the
  page. Returns `{report, feedback}` in one call: the hydrated
  `report_versions` row (with its `structured_findings`) and every
  feedback row already attached to it. Password-gated like
  `/feedback`. 503 when D1 isn't wired (unlike `/feedback`,
  there's no honest default), 404 for an unknown report.

### How the page works

- Set-password button → `sessionStorage`, never sent anywhere but
  this worker.
- Load → `GET /strategist/report/{id}` and render:
  - A whole-report feedback form (always open).
  - One card per structured finding with an "Add feedback" toggle;
    the finding's text pre-fills the form's `original_output` so
    the strategist edits a draft rather than retyping.
  - A "Captured feedback" list showing pending vs. approved so the
    strategist can see what's already on the record.
- Save → `POST /feedback` with the finding scope. Re-loads the
  report so the just-saved row appears in the captured list.

### Scope boundary (unchanged from Phase 3A)

Nothing about the UI changes the capture discipline:
- No row is written as approved. The approval column stays `0`.
- No row is retroactive. Feedback is attached to the exact
  `report_id` the strategist loaded.
- Nothing in Solomon's generator reads from this table.

## Rule promotion (Phase 3C)

Phase 3C is the final step in the learning loop: a human reviews
accumulated strategist feedback, approves rows that reflect a real
and generalizable mistake, and (separately) hand-authors the
`candidate_rule` text that will go into the next
`ASSESSMENT_RUBRIC`. The UI lives inside `/asksolomon` — the same
console used to train and test Solomon — so the two human roles map
cleanly to two surfaces:

- `/strategist` → per-report capture (Phase 3B).
- `/asksolomon` → Rule Promotions pane (Phase 3C).

### Endpoints

All CONSOLE_PASSWORD-gated.

- `GET /feedback/pending-summary` — one row per `feedback_type` that
  has at least one captured feedback record, with `pending_count` and
  `approved_count`. Drives the Promotions pane's top-level view.
  Degrades to `{success:true, skipped:true, summary:[]}` when D1
  isn't wired.
- `GET /feedback/approved?feedback_type=<T>` — approved rows for one
  type, newest first. Backs the "Export approved batch" view. 400
  on an unknown or missing `feedback_type`.
- `PATCH /feedback/{id}` — update a single feedback row. The only
  mutable fields are `approved_for_learning` and `candidate_rule`;
  everything else about a feedback row (its scope, its original
  critique) stays immutable from this layer. Approving stamps
  `approved_by` + `approved_at`; unapproving clears both. 404 when
  the row doesn't exist.

### UI flow

1. Open `/asksolomon`, click **Open** next to **Rule Promotions (3C)**.
2. The modal lists each `feedback_type` with its pending/approved
   counts. Types with zero captured rows don't appear.
3. **Review** on a type → pending rows, newest first. Each row shows
   the strategist's original/revision/reason and an editable
   `candidate_rule` textarea pre-filled with the strategist's draft.
4. Edit the rule text, then **Approve** to flip the row's
   `approved_for_learning` and stamp the approver. **Save draft rule**
   edits the rule without approving — useful when you want to
   generalize the strategist's wording before deciding.
5. **Export** on a type (visible once at least one row is approved) →
   a monospace text block of all approved candidate rules for that
   type, ready to paste into `ASSESSMENT_RUBRIC` after a
   `rubric_version` bump.

### What Phase 3C is **not**

- Not auto-training. Nothing in Solomon's generator reads
  `strategist_feedback`. Promotion is a human in the loop editing
  code: bump `rubric_version` (e.g. `r2.0` → `r2.1`), paste the
  approved rules into `ASSESSMENT_RUBRIC`, add a regression test if
  the rule warrants one, run the suite, deploy. Past reports stay
  stamped with their original version for audit.
- Not retroactive. An approved rule only affects generations run
  after the deploy that includes it.
- Not public. The UI lives behind CONSOLE_PASSWORD; the API routes
  reject unauthenticated calls with 401 and the review page
  doesn't surface anything to a non-authenticated viewer.
