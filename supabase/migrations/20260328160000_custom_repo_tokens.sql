-- ═══════════════════════════════════════════════════════════════════
-- Add encrypted custom GitHub token support per repo
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.repos
  ADD COLUMN IF NOT EXISTS custom_github_token text,
  ADD COLUMN IF NOT EXISTS custom_token_iv text,
  ADD COLUMN IF NOT EXISTS custom_token_tag text;

-- These columns store an AES-256-GCM encrypted GitHub PAT
-- for accessing private repos the user doesn't own via OAuth.
-- NULL means "use the user's OAuth token" (default behavior).
