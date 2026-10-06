-- Solomon canonical store — strategist feedback capture (Phase 3A).
--
-- The strategist can attach feedback to a specific report_id (whole
-- report) or report_id + finding_id (one structured finding). Feedback
-- is captured, categorized, and REST'd — nothing in this schema makes
-- Solomon learn from itself. Rule promotion is a separate, human-gated
-- step (Phase 3C) that reads approved rows out of this table.
--
-- See docs/SOLOMON_ARCHITECTURE.md § 21-23 (Learning System /
-- Approved Learning Categories / Promotion of Learning Into Rules).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS strategist_feedback (
  id                     TEXT PRIMARY KEY,                 -- UUID
  report_id              TEXT NOT NULL,                    -- → report_versions.id
  submission_id          TEXT,                             -- denormalized for queries
  contact_id             TEXT,                             -- denormalized for queries
  finding_id             TEXT,                             -- null for whole-report feedback,
                                                           -- else a structured_findings.finding_id
  feedback_type          TEXT NOT NULL,                    -- see docs for the 16 allowed values
  original_output        TEXT,                             -- the sentence/finding that was wrong
  strategist_revision    TEXT,                             -- what it should have said
  reason                 TEXT,                             -- strategist's explanation
  candidate_rule         TEXT,                             -- proposed rubric rule for 3C review
  approved_for_learning  INTEGER NOT NULL DEFAULT 0,       -- 0 = pending, 1 = human-approved
  approved_by            TEXT,                             -- strategist id/email, null if pending
  approved_at            INTEGER,                          -- unix ms, null if pending
  created_by             TEXT,                             -- who filed the feedback
  created_at             INTEGER NOT NULL,                 -- unix ms
  FOREIGN KEY (report_id) REFERENCES report_versions(id)
);

-- Fetch all feedback on a report (strategist review UI).
CREATE INDEX IF NOT EXISTS strategist_feedback_by_report
  ON strategist_feedback (report_id, created_at DESC);

-- Fetch all pending feedback of a given type (rule-promotion review queue).
CREATE INDEX IF NOT EXISTS strategist_feedback_pending_by_type
  ON strategist_feedback (feedback_type, approved_for_learning, created_at DESC);

-- Fetch everything for one contact across all of their reports (lifecycle view).
CREATE INDEX IF NOT EXISTS strategist_feedback_by_contact
  ON strategist_feedback (contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;
