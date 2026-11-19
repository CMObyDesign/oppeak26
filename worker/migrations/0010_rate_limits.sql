-- Per-IP fixed-window rate limit counters (security review 2026-11-19).
--
-- Used by the unauthenticated Claude-calling marketing audit routes
-- (/audit/render, /marketing/render, POST /audit, POST /marketing) so one
-- client can't run up Anthropic spend. One row per (scope, ip, window).
-- `bucket_key` = "<scope>|<ip>|<window-start-epoch-seconds>".
-- Rows are pruned opportunistically by the Worker once expired.
--
-- If this migration hasn't been applied yet the Worker fails OPEN (logs a
-- warning and serves the audit) so a deploy-before-migrate never breaks
-- the public audit page.

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key  TEXT PRIMARY KEY,
  count       INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL          -- epoch seconds when the window ends
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits (expires_at);
