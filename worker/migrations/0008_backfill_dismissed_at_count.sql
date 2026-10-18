-- BGA Copilot — backfill `dismissed_at_count` for rows dismissed
-- before migration 0007 shipped (Codex P2 follow-up on #143).
--
-- 0007 added `dismissed_at_count` nullable. The _scanOverrides reopen
-- rule uses it as the stable baseline for the "did overrides grow by
-- DISMISS_REOPEN_DELTA?" check. For rows dismissed before 0007 landed,
-- the column was NULL, and the fallback in learning_loop.js reads
-- `prior.occurrence_count` instead — but the same scan's refresh
-- branch advances occurrence_count on every pass. Result: those
-- pre-0007 dismissals never reopen (delta always 1), exactly the bug
-- 0007 was meant to close.
--
-- This migration sets `dismissed_at_count = occurrence_count` for
-- every dismissed row that still has NULL in the new column, so the
-- fix applies retroactively. Idempotent: the NULL guard means
-- re-running the migration is a no-op.
--
-- Deploy order:
--   1. Apply this migration AFTER 0007 (if 0007 was not yet applied
--      to prod when this fix PR lands, you can apply 0007 and 0008
--      back-to-back — the net effect is identical).
--   2. Deploy the worker (no code change needed for the backfill
--      itself; _scanOverrides already prefers the column when
--      non-null, which this UPDATE guarantees).

PRAGMA foreign_keys = ON;

UPDATE bga_pending_rule_suggestions
   SET dismissed_at_count = occurrence_count
 WHERE status = 'dismissed'
   AND dismissed_at_count IS NULL;
