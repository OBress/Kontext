-- Add dismissed_at column to repo_check_findings
-- When non-null, the finding is hidden from default views (user-dismissed / blacklisted)
ALTER TABLE repo_check_findings
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz DEFAULT NULL;

-- Index for efficient filtering of non-dismissed findings
CREATE INDEX IF NOT EXISTS idx_repo_check_findings_dismissed
  ON repo_check_findings (user_id, repo_full_name, status)
  WHERE dismissed_at IS NULL;
