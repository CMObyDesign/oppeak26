# Cloudflare Data Model — D1 canonical store

Companion to `docs/SOLOMON_ARCHITECTURE.md`. The contracts live there;
this file documents **what** lives in D1, **why**, and **how** to wire the
database up.

## Status

| Phase | What it does | State |
|---|---|---|
| 1a | Schema + migration + data-access module | shipped |
| 1b | Dual-write from `handleGHLSurveyWebhook` and `handleConsoleRun`, R2 HTML artifact | shipped |
| **1c** | `/report/{contactId}` reads D1 with GHL fallback; `?v=N` / `?report_id=` history | **shipped (this change)** |

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

## Not in Phase 1

- Normalization answers (`normalized_answers_json`) — Phase 2
- Derived metrics (`derived_metrics_json`) — Phase 2
- Structured findings schema inside `diagnostic_json` — Phase 2
- Strategist feedback capture — Phase 3

The schema has columns reserved for all four so Phase 2/3 don't require a
migration.
