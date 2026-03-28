-- Architecture analysis cache columns
-- Stores the AI-generated architectural analysis to avoid re-analyzing on every page load

ALTER TABLE repos ADD COLUMN IF NOT EXISTS architecture_analysis jsonb DEFAULT NULL;
ALTER TABLE repos ADD COLUMN IF NOT EXISTS architecture_analyzed_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN repos.architecture_analysis IS 'Cached AI architectural analysis (components, connections, descriptions)';
COMMENT ON COLUMN repos.architecture_analyzed_at IS 'Timestamp of last AI architecture analysis';
