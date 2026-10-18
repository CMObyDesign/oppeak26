-- BGA Copilot — reconstruct the historical dismissal baseline
-- (Codex P2 follow-up on #144).
--
-- 0008 backfilled `dismissed_at_count = occurrence_count` for every
-- dismissed row with NULL. That's wrong when any scan ran between
-- the row's dismissal and the migration: `occurrence_count` would
-- have drifted upward on each rescan (the pre-fix refresh branch),
-- so copying its current value captures a baseline LATER than the
-- real dismissal count. Example: a row dismissed at 2 refreshed at
-- 3 and 4 gets baseline=4 under 0008, and now reopens only at 7
-- instead of the documented 5.
--
-- This migration recomputes dismissed_at_count AS OF the row's
-- `decided_at` by counting the overrides that were non-revoked at
-- that moment. Those are exactly the overrides that would have
-- contributed to `occurrence_count` at dismiss time, had slice D's
-- decide handler captured a stable baseline from day one.
--
-- Applied to EVERY status='dismissed' row (not just NULL ones) so
-- it corrects 0008's naive snapshots AND handles rows the live
-- post-0007 decide handler already captured correctly (for those,
-- the computed value matches what the handler stored — effectively
-- a no-op). Rows dismissed before any contributing override existed
-- land at 0, which is the right behavior: they reopen as soon as
-- the count reaches DISMISS_REOPEN_DELTA.
--
-- COALESCE fallback: if `decided_at` is somehow NULL (should not
-- happen — the decide handler always writes it — but defensively
-- in case of pre-slice-D data), keep whatever the current column
-- holds instead of silently zeroing it.
--
-- Idempotent: re-running recomputes the same value from the same
-- fixed inputs. Safe to apply after 0008, OR back-to-back with
-- 0007 + 0008 if none have been applied yet.
--
-- Deploy order:
--   1. Apply this migration AFTER 0008 (or back-to-back with 0007
--      + 0008 if neither has landed in prod yet).
--   2. No worker redeploy needed; _scanOverrides already reads
--      `dismissed_at_count` as the stable baseline.

PRAGMA foreign_keys = ON;

UPDATE bga_pending_rule_suggestions AS p
   SET dismissed_at_count = COALESCE(
     (
       SELECT COUNT(*)
       FROM bga_strategist_overrides o
       WHERE o.service_id = p.service_id
         AND o.action     = p.action
         AND o.created_at <= p.decided_at
         AND (o.revoked_at IS NULL OR o.revoked_at > p.decided_at)
     ),
     p.dismissed_at_count,
     0
   )
 WHERE p.status      = 'dismissed'
   AND p.decided_at IS NOT NULL;
