-- BGA Copilot — pending-rule-suggestions dismissal baseline
-- (Codex P2 on #141 learning-loop review).
--
-- The dismiss-reopen check in _scanOverrides needs a STABLE baseline
-- to compare against. Before this migration, it compared the current
-- override count against `occurrence_count` on the existing row — but
-- the "refresh" branch of _scanOverrides advanced that same column on
-- every rescan while the row was dismissed. Result: a suggestion
-- dismissed at count=2 and then scanned at counts 3, 4, 5 never
-- reopened, because each subsequent `shouldReopen` compared against
-- the immediately-preceding count (delta always 1).
--
-- This migration adds `dismissed_at_count` — set when a suggestion is
-- dismissed, cleared when it's reopened or set to any non-dismissed
-- status. The reopen check now reads from this frozen baseline so
-- "+N occurrences since the admin said no" is measured correctly.
--
-- Deploy order:
--   1. Apply this migration to prod D1.
--   2. Deploy the worker (learning_loop.js + decide handler updated
--      in the same PR).

PRAGMA foreign_keys = ON;

ALTER TABLE bga_pending_rule_suggestions
  ADD COLUMN dismissed_at_count INTEGER;
