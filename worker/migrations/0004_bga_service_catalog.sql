-- BGA Copilot — mutable service catalog + Premium CFO bundles
-- (customer directive 2026-10-17, slice A of 5).
--
-- Moves the service catalog + bundle configuration from the deploy-
-- bundled `worker/data/service_catalog.json` into D1 so authorized
-- staff can edit without a code deploy. The catalog is still versioned
-- (every published edit creates a new immutable `bga_catalog_versions`
-- row) and every BGA case still records the version it was built
-- against via `swot_bga_services_catalog_ref`, so red-team / version-
-- history auditing is unaffected.
--
-- Backward compat during rollout:
--   - If `bga_catalog_active.active_version_id` is NULL (fresh deploy,
--     no admin has published yet), the loader seeds D1 from the
--     bundled JSON on first access.
--   - If D1 is unreachable (cold worker, DB outage), the loader falls
--     back to the bundled JSON. The catalog version in that case is
--     the JSON-hash short SHA the loader already computed under the
--     old scheme, so stored case-level catalog refs stay comparable.
--
-- Slice boundaries:
--   A (this migration): schema + loader rewrite + JSON seed fallback.
--   B: admin CRUD UI (Settings → Service Catalog + Settings → Bundles).
--   C: per-case strategist overrides (bga_strategist_overrides).
--   D: learning loop (bga_pending_rule_suggestions).
--   E: audit + any missing per-case catalog_version pins.
--
-- Deploy order:
--   1. Apply this migration to prod D1.
--   2. Deploy the worker (loader rewrite ships in the same PR).
--   3. First BGA case run after deploy seeds D1 from the bundled JSON
--      and promotes that snapshot to active version 1.

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────
-- bga_catalog_versions — one row per published snapshot of the catalog.
-- Rows are IMMUTABLE after insert; any further edit creates a new row.
-- A version is only "active" (served to the matcher) when its id
-- matches bga_catalog_active.active_version_id below. Previous versions
-- stay in the table so an older BGA case can be replayed against the
-- rubric it was built with.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bga_catalog_versions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  published_at    TEXT    NOT NULL,          -- ISO-8601 UTC
  published_by    TEXT    NOT NULL,          -- operator identifier (email, "seed", etc.)
  note            TEXT,                      -- human-readable rationale ("add new VF service", etc.)
  services_sha    TEXT    NOT NULL,          -- SHA-256 (first 12 hex) of the services snapshot
  bundles_sha     TEXT    NOT NULL,          -- SHA-256 (first 12 hex) of the bundles snapshot
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bga_catalog_versions_published_at
  ON bga_catalog_versions(published_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- bga_services — the services belonging to a specific catalog version.
-- JSON-serialized fields keep the loader's shape close to the current
-- bundled JSON, so match_services.js keeps working against the row set
-- with minimal churn.
--
-- The three rule columns (defer_rules, caution_rules, hard_block_rules)
-- replace the single `when_not_to_recommend` field in the old JSON:
--   - hard_block_rules — strategist cannot include this service for the
--     case (e.g. active legal distress)
--   - caution_rules    — service shows with a warning that must be
--     acknowledged
--   - defer_rules      — service shows but is downranked / recommended
--     to defer to a later engagement
--
-- customer_value_points is new — strategist talking points were
-- internal-only; customer-facing value needs its own slot so the paid
-- report can quote it directly without re-interpretation.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bga_services (
  id                           INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id                   INTEGER NOT NULL REFERENCES bga_catalog_versions(id) ON DELETE CASCADE,
  service_id                   TEXT    NOT NULL,         -- stable string id, unique within a version
  name                         TEXT    NOT NULL,
  problem_solved               TEXT,
  signals_relevant_json        TEXT    NOT NULL DEFAULT '[]',
  hard_block_rules_json        TEXT    NOT NULL DEFAULT '[]',  -- was when_not_to_recommend
  caution_rules_json           TEXT    NOT NULL DEFAULT '[]',  -- new (slice A)
  defer_rules_json             TEXT    NOT NULL DEFAULT '[]',  -- new (slice A)
  deliverables_json            TEXT    NOT NULL DEFAULT '[]',
  client_responsibility_json   TEXT    NOT NULL DEFAULT '[]',
  cfobd_responsibility_json    TEXT    NOT NULL DEFAULT '[]',
  pricing_json                 TEXT    NOT NULL DEFAULT '{}',
  bundle_eligibility_json      TEXT    NOT NULL DEFAULT '{}',
  dependencies_json            TEXT    NOT NULL DEFAULT '[]',
  talking_points_json          TEXT    NOT NULL DEFAULT '[]',    -- strategist-internal
  customer_value_points_json   TEXT    NOT NULL DEFAULT '[]',    -- new (slice A), customer-facing
  is_active                    INTEGER NOT NULL DEFAULT 1,       -- 0 = archived in this version
  created_at                   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(version_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_bga_services_version
  ON bga_services(version_id);
CREATE INDEX IF NOT EXISTS idx_bga_services_service_id
  ON bga_services(service_id);

-- ─────────────────────────────────────────────────────────────────────
-- bga_bundles — Premium CFO Bundle (and future bundles) configuration.
-- Also versioned alongside services so a case recorded against version
-- N can replay against the bundle definitions that were live at N.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bga_bundles (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id                INTEGER NOT NULL REFERENCES bga_catalog_versions(id) ON DELETE CASCADE,
  bundle_id                 TEXT    NOT NULL,         -- stable string id, unique within a version
  name                      TEXT    NOT NULL,
  description               TEXT,
  included_service_ids_json TEXT    NOT NULL DEFAULT '[]',
  pricing_json              TEXT    NOT NULL DEFAULT '{}',
  is_active                 INTEGER NOT NULL DEFAULT 1,
  created_at                TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(version_id, bundle_id)
);

CREATE INDEX IF NOT EXISTS idx_bga_bundles_version
  ON bga_bundles(version_id);

-- ─────────────────────────────────────────────────────────────────────
-- bga_catalog_active — single-row pointer to the currently-published
-- catalog version. INSERT OR REPLACE on singleton=1 to swap. NULL
-- active_version_id means "no admin has published yet; loader seeds
-- from bundled JSON." Published-by + published-at duplicated here from
-- the versions row so the admin UI can render "active since …" without
-- a join.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bga_catalog_active (
  singleton          INTEGER PRIMARY KEY CHECK (singleton = 1),
  active_version_id  INTEGER REFERENCES bga_catalog_versions(id),
  activated_at       TEXT,
  activated_by       TEXT
);

INSERT OR IGNORE INTO bga_catalog_active (singleton, active_version_id)
VALUES (1, NULL);
