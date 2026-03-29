-- ============================================================================
-- Migration: AI-Powered Development Timeline
-- Adds AI summary + embedding columns to repo_commits,
-- push_group_id for grouping commits by push event,
-- encrypted AI key columns on user_tokens,
-- and a match_timeline RPC for vector search over commit summaries.
-- ============================================================================

-- 1. New columns on repo_commits
ALTER TABLE public.repo_commits
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS ai_summary_embedding extensions.vector(1536),
  ADD COLUMN IF NOT EXISTS push_group_id text;

-- 2. Index for fast vector search on timeline summaries
CREATE INDEX IF NOT EXISTS idx_repo_commits_summary_embedding
  ON public.repo_commits
  USING ivfflat (ai_summary_embedding extensions.vector_cosine_ops)
  WITH (lists = 50);

-- 3. Index for grouping by push
CREATE INDEX IF NOT EXISTS idx_repo_commits_push_group
  ON public.repo_commits (user_id, repo_full_name, push_group_id);

-- 4. Encrypted AI key columns on user_tokens
ALTER TABLE public.user_tokens
  ADD COLUMN IF NOT EXISTS encrypted_ai_key text,
  ADD COLUMN IF NOT EXISTS ai_key_iv text,
  ADD COLUMN IF NOT EXISTS ai_key_tag text;

-- 5. RPC: match_timeline — vector search over AI commit summaries
CREATE OR REPLACE FUNCTION public.match_timeline(
  query_embedding extensions.vector,
  match_count integer DEFAULT 5,
  filter_repo text DEFAULT NULL,
  filter_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  sha text,
  message text,
  ai_summary text,
  author_name text,
  author_avatar_url text,
  committed_at timestamptz,
  push_group_id text,
  files_changed jsonb,
  similarity double precision
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    rc.id, rc.sha, rc.message, rc.ai_summary,
    rc.author_name, rc.author_avatar_url,
    rc.committed_at, rc.push_group_id,
    rc.files_changed,
    1 - (rc.ai_summary_embedding <=> query_embedding) AS similarity
  FROM public.repo_commits rc
  WHERE
    rc.ai_summary_embedding IS NOT NULL
    AND (filter_user_id IS NULL OR rc.user_id = filter_user_id)
    AND (filter_repo IS NULL OR rc.repo_full_name = filter_repo)
  ORDER BY rc.ai_summary_embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

ALTER FUNCTION public.match_timeline(extensions.vector, integer, text, uuid) OWNER TO postgres;
