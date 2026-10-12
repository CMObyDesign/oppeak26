-- BGA Copilot — approve-and-send idempotency / concurrency lock
-- (PR 12; spec §5.4 step 3, §5 "Why D1-backed, not in-memory").
--
-- One row per contact who has ever had APPROVE & SEND TO CLIENT fire
-- successfully (or at least gotten past step 3 of §5.4). The
-- `contact_id` is the primary key, so a second request for the same
-- contact loses the INSERT race and is refused with 409 before it
-- reaches any GHL call.
--
-- Why D1 instead of an in-memory mutex: Workers isolates are not
-- long-lived and don't share state across requests to different
-- isolates. D1's SQLite primary-key uniqueness is strongly consistent
-- for writes to the same database and is the right tool for a
-- cross-isolate serialization point.
--
-- Row retention: the row stays as the permanent "has sent" record
-- after a successful send. On any failure AFTER lock acquisition
-- (steps 4-9 per §5.4), the handler DELETEs the row so a corrected
-- retry is possible.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bga_send_locks (
  contact_id   TEXT PRIMARY KEY,       -- GHL contact id
  acquired_at  TEXT NOT NULL           -- ISO-8601 UTC timestamp of the lock insert
);
