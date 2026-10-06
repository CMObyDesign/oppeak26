-- Solomon canonical store — initial schema.
--
-- Contracts (see docs/SOLOMON_ARCHITECTURE.md):
--
--   HighLevel latest-state:  swot_* custom fields hold the latest successful
--                            customer-facing result. Not system of record.
--   D1 historical:           every generation is a new immutable row. Prior
--                            rows are never overwritten.
--   Answer snapshot:         the complete set of answers used for a generation
--                            is stored as a whole snapshot. Later edits do not
--                            mutate historical snapshots.
--   Report read:             /report/{contactId} resolves to the latest
--                            successful row (default) or an explicit
--                            version/id (history). Never reconstructed from
--                            live GHL fields.
--   R2 artifact:             rendered HTML belongs in R2; D1 holds metadata
--                            and the R2 object key.
--
-- Three tables:
--   submissions      — one row per intake (answers + validation + metrics)
--   report_versions  — one row per Solomon generation (bound to a submission)
--   ghl_sync         — one row per writeback attempt (bound to a report)

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- submissions
--
-- One row per intake. `raw_answers_json` is the whole-snapshot record of the
-- answers Solomon ran against — the Answer snapshot contract. Later owner
-- edits to GHL fields do not mutate this row. `source_event_id` is the GHL
-- webhook / request identifier that produced this submission; the UNIQUE
-- (source_event_id, tier, assessment_version) index gives us durable
-- idempotency replacing the short-TTL reserveIdempotency check.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS submissions (
  id                       TEXT PRIMARY KEY,                 -- UUID
  contact_id               TEXT NOT NULL,
  tier                     TEXT NOT NULL,                    -- 'free' | 'paid_47' | 'paid_297'
  assessment_version       TEXT NOT NULL DEFAULT 'v1',
  source_event_id          TEXT,                             -- GHL webhook id or request id
  created_at               INTEGER NOT NULL,                 -- unix ms
  raw_answers_json         TEXT NOT NULL,                    -- JSON array of answers (full snapshot)
  normalized_answers_json  TEXT,                             -- JSON array of normalized answers (Phase 2)
  derived_metrics_json     TEXT,                             -- JSON object of code-computed metrics (Phase 2)
  validation_json          TEXT,                             -- JSON {complete, missing_fields, warnings}
  status                   TEXT NOT NULL DEFAULT 'ready'     -- 'ready' | 'incomplete' | 'failed'
);

CREATE INDEX IF NOT EXISTS submissions_contact_created
  ON submissions (contact_id, created_at DESC);

-- Durable idempotency: a given GHL webhook event + tier + assessment version
-- can only create one submission. Short-TTL `reserveIdempotency` becomes a
-- secondary optimization once this is in place.
CREATE UNIQUE INDEX IF NOT EXISTS submissions_source_event_unique
  ON submissions (source_event_id, tier, assessment_version)
  WHERE source_event_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- report_versions
--
-- One row per Solomon generation. report_version is monotonically increasing
-- within a submission (1, 2, 3, …) — a regeneration creates a new row with
-- version N+1 while version N stays reachable. Reports are immutable; a
-- correction creates a new row. r2_html_key is the R2 object key for the
-- rendered HTML artifact; the HTML itself is never stored inline here.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_versions (
  id                     TEXT PRIMARY KEY,                   -- UUID (report_id)
  submission_id          TEXT NOT NULL,
  contact_id             TEXT NOT NULL,                      -- denormalized for /report lookups
  tier                   TEXT NOT NULL,                      -- denormalized for /report lookups
  report_version         INTEGER NOT NULL,                   -- 1, 2, 3 ... per submission
  classification         TEXT,                               -- 'growth' | 'needs-attention' | 'rehab'
  diagnostic_json        TEXT NOT NULL,                      -- the agent object (findings, opportunities, etc.)
  strategist_brief_json  TEXT,                               -- internal-only brief (may contain customer analysis)
  prompt_version         TEXT,                               -- rubric prompt version string
  rubric_version         TEXT,                               -- assessment rubric version string
  model_version          TEXT,                               -- 'claude-sonnet-4-5-20250929' etc.
  code_version           TEXT,                               -- git SHA of the worker code at generation time
  r2_html_key            TEXT,                               -- R2 object key for the rendered HTML (null until Phase 1d)
  r2_html_bytes          INTEGER,                            -- artifact size
  r2_html_sha256         TEXT,                               -- content hash for dedup
  created_at             INTEGER NOT NULL,                   -- unix ms
  is_successful          INTEGER NOT NULL DEFAULT 1,         -- 0 = failed generation retained for audit
  FOREIGN KEY (submission_id) REFERENCES submissions(id)
);

CREATE INDEX IF NOT EXISTS report_versions_contact_latest
  ON report_versions (contact_id, is_successful, created_at DESC);

CREATE INDEX IF NOT EXISTS report_versions_submission
  ON report_versions (submission_id, report_version);

CREATE UNIQUE INDEX IF NOT EXISTS report_versions_submission_version
  ON report_versions (submission_id, report_version);

-- -----------------------------------------------------------------------------
-- ghl_sync
--
-- One row per writeback attempt — tracks whether a generated report's
-- projection landed in HighLevel. Retries append new rows; the latest row
-- per report_id gives the current sync state. If HighLevel is down, the
-- diagnostic is never lost: `report_versions` already has it; `ghl_sync`
-- just marks the projection as pending/failed and gives retry metadata.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ghl_sync (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id        TEXT NOT NULL,
  contact_id       TEXT NOT NULL,
  status           TEXT NOT NULL,                            -- 'pending' | 'succeeded' | 'failed'
  attempt_count    INTEGER NOT NULL DEFAULT 1,
  last_error       TEXT,
  last_attempt_at  INTEGER NOT NULL,                         -- unix ms
  synced_at        INTEGER,                                  -- unix ms (null until first success)
  FOREIGN KEY (report_id) REFERENCES report_versions(id)
);

CREATE INDEX IF NOT EXISTS ghl_sync_report
  ON ghl_sync (report_id, last_attempt_at DESC);

CREATE INDEX IF NOT EXISTS ghl_sync_pending
  ON ghl_sync (status, last_attempt_at)
  WHERE status != 'succeeded';
