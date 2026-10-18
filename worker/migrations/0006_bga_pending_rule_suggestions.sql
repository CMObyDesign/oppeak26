-- BGA Copilot — pending rule suggestions (slice D of 5; customer
-- directive 2026-10-17).
--
-- Slice C logged per-case strategist overrides (include / defer /
-- not_a_fit / manual_add / edit_reason / edit_dependencies) into
-- `bga_strategist_overrides`. Slice D is the LEARNING LOOP that reads
-- that log, groups repeated divergences by (service_id, action),
-- and surfaces them as PENDING SUGGESTIONS a human must review.
--
-- CUSTOMER DIRECTIVE (enforced by schema + handlers): "Do not
-- automatically update catalog rules from one case." This table is
-- the human-in-the-loop boundary. Nothing in this slice ever
-- mutates `bga_services` or `bga_bundles`. Approval here is a
-- recommendation to the admin; applying the change still goes
-- through the slice-B publish flow in `/asksolomon/catalog`.
--
-- A suggestion is DETERMINISTIC — the aggregator produces the same
-- `pattern_key` for the same (service_id, action, time window), so
-- repeated scans update one row rather than creating duplicates.
-- The admin's decision (approve / dismiss / applied) is sticky:
-- re-scanning does not reopen a dismissed suggestion unless new
-- overrides push the pattern above a materiality threshold.
--
-- Deploy order:
--   1. Apply this migration to prod D1.
--   2. Deploy the worker (handlers + admin UI ship in the same PR).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bga_pending_rule_suggestions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_key          TEXT    NOT NULL UNIQUE,       -- deterministic: service_id|action — one row per
                                                      -- (service, action) grouping across the whole log,
                                                      -- so a rescan upserts and never duplicates.
  service_id           TEXT    NOT NULL,
  action               TEXT    NOT NULL               -- action class the overrides fell into — mirrors
                               CHECK (action IN (     -- the override action set from migration 0005.
                                 'defer', 'not_a_fit', 'manual_add',
                                 'edit_dependencies'
                               )),
  summary              TEXT    NOT NULL,              -- human-readable sentence rendered in the admin UI
  evidence_json        TEXT    NOT NULL DEFAULT '[]', -- [{override_id, contact_id, reason, created_by,
                                                      --   created_at, catalog_version_id}, …]
                                                      -- up to the N most-recent contributing rows (so
                                                      -- the row size stays bounded).
  proposed_patch_json  TEXT    NOT NULL DEFAULT '{}', -- action-specific hint for the admin:
                                                      --   not_a_fit: {"field":"hard_block_rules_or_caution",
                                                      --               "shared_signals":[…]}
                                                      --   defer:     {"field":"defer_rules",
                                                      --               "shared_signals":[…]}
                                                      --   manual_add:{"candidate_names":[…]}
                                                      --   edit_dependencies:{"proposed_deps":[…]}
  occurrence_count     INTEGER NOT NULL DEFAULT 0,    -- how many non-revoked overrides contribute
  status               TEXT    NOT NULL DEFAULT 'pending'
                               CHECK (status IN (
                                 'pending', 'approved', 'dismissed', 'applied'
                               )),
  decided_by           TEXT,                          -- operator who approved / dismissed / marked applied
  decided_at           TEXT,
  decision_note        TEXT,
  first_seen_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  last_scanned_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bga_prs_status
  ON bga_pending_rule_suggestions(status, occurrence_count DESC);

CREATE INDEX IF NOT EXISTS idx_bga_prs_service
  ON bga_pending_rule_suggestions(service_id, action);
