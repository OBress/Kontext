-- Migration: Hybrid Search (Vector + Full-Text + RRF)
-- Adds tsvector column to repo_chunks for keyword search,
-- a GIN index for fast FTS, and a hybrid_match_chunks RPC
-- that fuses vector + keyword results via Reciprocal Rank Fusion.

-- 1. Add tsvector column (auto-generated from content)
ALTER TABLE public.repo_chunks
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- 2. Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_repo_chunks_fts
  ON public.repo_chunks USING GIN(fts);

-- 3. Create hybrid search RPC using Reciprocal Rank Fusion
CREATE OR REPLACE FUNCTION public.hybrid_match_chunks(
  query_text text,
  query_embedding extensions.vector,
  match_count integer DEFAULT 25,
  filter_repo text DEFAULT NULL,
  filter_user_id uuid DEFAULT NULL,
  full_text_weight float DEFAULT 1.0,
  semantic_weight float DEFAULT 1.0,
  rrf_k integer DEFAULT 60
)
RETURNS TABLE (
  id bigint,
  file_path text,
  content text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
WITH full_text_search AS (
  SELECT rc.id,
    ROW_NUMBER() OVER (
      ORDER BY ts_rank(rc.fts, websearch_to_tsquery('english', query_text)) DESC
    ) AS rank
  FROM public.repo_chunks rc
  WHERE rc.fts @@ websearch_to_tsquery('english', query_text)
    AND (filter_user_id IS NULL OR rc.user_id = filter_user_id)
    AND (filter_repo IS NULL OR rc.repo_full_name = filter_repo)
  LIMIT match_count * 2
),
semantic_search AS (
  SELECT rc.id,
    ROW_NUMBER() OVER (
      ORDER BY rc.embedding <=> query_embedding
    ) AS rank
  FROM public.repo_chunks rc
  WHERE (filter_user_id IS NULL OR rc.user_id = filter_user_id)
    AND (filter_repo IS NULL OR rc.repo_full_name = filter_repo)
  ORDER BY rc.embedding <=> query_embedding
  LIMIT match_count * 2
)
SELECT
  rc.id,
  rc.file_path,
  rc.content,
  (
    COALESCE(full_text_weight / (rrf_k + fts.rank), 0.0) +
    COALESCE(semantic_weight / (rrf_k + sem.rank), 0.0)
  ) AS similarity
FROM public.repo_chunks rc
LEFT JOIN full_text_search fts ON rc.id = fts.id
LEFT JOIN semantic_search sem ON rc.id = sem.id
WHERE fts.id IS NOT NULL OR sem.id IS NOT NULL
ORDER BY similarity DESC
LIMIT match_count;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.hybrid_match_chunks TO authenticated;
