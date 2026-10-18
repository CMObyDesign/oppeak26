-- BGA Copilot — per-case strategist overrides (slice C of 5;
-- customer directive 2026-10-17).
--
-- Slice A moved the service catalog into D1 (migration 0004); slice B
-- added the admin surface to edit it. Both are catalog-level: an edit
-- changes the catalog for every case run against the new version.
--
-- Slice C adds the PER-CASE override log — a strategist can mark a
-- specific service as include / defer / not_a_fit / manual_add on ONE
-- case, with a reason, without touching the catalog. The overrides
-- never mutate `bga_services`, they never affect approve-and-send
-- (which already uses `swot_bga_services_selected`), and they never
-- feed back into the catalog on their own.
--
-- These rows are the raw material for slice D's learning loop: an
-- aggregator reads overrides across many cases, surfaces repeated
-- patterns ("3 strategists marked svc_vf as not_a_fit for new-business
-- signal") as pending rule suggestions, and only a human can accept a
-- suggestion into a published catalog version. "Do not automatically
-- update catalog rules from one case" (customer directive) is enforced
-- by the fact that THIS table is strictly append-only and separate.
--
-- Rows carry the catalog_version_id that was active at the time of
-- the override, so slice D can tell "this override was made against
-- rule set X; the catalog has since been republished with Y" and
-- weight the signal accordingly.
--
-- Revoke is soft: an undo sets `revoked_at`/`revoked_by` instead of
-- deleting the row, so the audit trail stays complete. Readers filter
-- revoked rows out of the "current state" view and keep them in the
-- "all history" view.
--
-- Deploy order:
--   1. Apply this migration to prod D1.
--   2. Deploy the worker (handlers + case-view UI panel ship in the
--      same PR).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bga_strategist_overrides (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id          TEXT    NOT NULL,                   -- GHL contact id (the case)
  catalog_version_id  INTEGER NOT NULL                    -- bga_catalog_versions.id active at override time
                              REFERENCES bga_catalog_versions(id),
  service_id          TEXT    NOT NULL,                   -- stable string id — a catalog service_id for
                                                          -- include/defer/not_a_fit/edit_*, or an
                                                          -- ad-hoc id for manual_add
  action              TEXT    NOT NULL                    -- include | defer | not_a_fit | manual_add
                              CHECK (action IN (          --   | edit_reason | edit_dependencies
                                'include', 'defer', 'not_a_fit',
                                'manual_add', 'edit_reason', 'edit_dependencies'
                              )),
  reason              TEXT,                               -- strategist's rationale; required for
                                                          -- defer/not_a_fit at the handler layer
  payload_json        TEXT    NOT NULL DEFAULT '{}',      -- action-specific data:
                                                          --   manual_add: { name, description?, deps? }
                                                          --   edit_dependencies: { deps: [...] }
                                                          --   edit_reason: { reason: "..." } (duplicates
                                                          --     the reason column for the aggregator)
                                                          --   include/defer/not_a_fit: {} (empty)
  created_by          TEXT    NOT NULL,                   -- strategist email / handle
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  revoked_at          TEXT,                               -- soft-delete: set when the strategist
                                                          -- undoes this override. NULL = active.
  revoked_by          TEXT                                -- who revoked (nullable; set when revoked_at is set)
);

CREATE INDEX IF NOT EXISTS idx_bga_strat_ovr_contact
  ON bga_strategist_overrides(contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bga_strat_ovr_version
  ON bga_strategist_overrides(catalog_version_id);

CREATE INDEX IF NOT EXISTS idx_bga_strat_ovr_service_action
  ON bga_strategist_overrides(service_id, action);
