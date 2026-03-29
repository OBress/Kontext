ALTER TABLE repos
  ADD COLUMN IF NOT EXISTS architecture_status text DEFAULT 'missing',
  ADD COLUMN IF NOT EXISTS architecture_for_sha text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS architecture_error text DEFAULT NULL;

UPDATE repos
SET architecture_status = CASE
  WHEN architecture_analysis IS NOT NULL THEN 'ready'
  ELSE 'missing'
END
WHERE architecture_status IS NULL;

COMMENT ON COLUMN repos.architecture_status IS 'Freshness/status of the cached architecture bundle.';
COMMENT ON COLUMN repos.architecture_for_sha IS 'Commit SHA the cached architecture bundle was generated from.';
COMMENT ON COLUMN repos.architecture_error IS 'Last non-fatal architecture refresh error shown in the UI.';
