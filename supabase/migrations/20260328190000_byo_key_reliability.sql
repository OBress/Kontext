-- ============================================================
-- Kontext BYO-Key Reliability
-- - repo sync blocked state fields
-- - richer ingestion job statuses
-- - transactional replace helpers for full ingest and sync
-- ============================================================

ALTER TABLE public.repos
  ADD COLUMN IF NOT EXISTS sync_blocked_reason text,
  ADD COLUMN IF NOT EXISTS pending_sync_head_sha text;

ALTER TABLE public.ingestion_jobs
  DROP CONSTRAINT IF EXISTS ingestion_jobs_status_check;

ALTER TABLE public.ingestion_jobs
  ADD CONSTRAINT ingestion_jobs_status_check
  CHECK (
    status = ANY (
      ARRAY[
        'pending'::text,
        'fetching'::text,
        'chunking'::text,
        'embedding'::text,
        'finalizing'::text,
        'timeline'::text,
        'done'::text,
        'blocked_quota'::text,
        'blocked_billing'::text,
        'blocked_model'::text,
        'error'::text
      ]
    )
  );

CREATE OR REPLACE FUNCTION public.replace_repo_index(
  p_user_id uuid,
  p_repo_full_name text,
  p_files jsonb,
  p_chunks jsonb,
  p_chunk_count integer,
  p_last_indexed_at timestamptz,
  p_last_synced_sha text DEFAULT NULL,
  p_watched_branch text DEFAULT NULL,
  p_indexed boolean DEFAULT true,
  p_indexing boolean DEFAULT false,
  p_sync_blocked_reason text DEFAULT NULL,
  p_pending_sync_head_sha text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.repo_chunks
  WHERE user_id = p_user_id
    AND repo_full_name = p_repo_full_name;

  DELETE FROM public.repo_files
  WHERE user_id = p_user_id
    AND repo_full_name = p_repo_full_name;

  IF p_files IS NOT NULL AND jsonb_typeof(p_files) = 'array' THEN
    INSERT INTO public.repo_files (
      user_id,
      repo_full_name,
      file_path,
      file_name,
      extension,
      line_count,
      size_bytes,
      content_hash,
      imports
    )
    SELECT
      p_user_id,
      p_repo_full_name,
      file->>'file_path',
      file->>'file_name',
      NULLIF(file->>'extension', ''),
      COALESCE((file->>'line_count')::integer, 0),
      COALESCE((file->>'size_bytes')::integer, 0),
      NULLIF(file->>'content_hash', ''),
      COALESCE(
        ARRAY(
          SELECT jsonb_array_elements_text(COALESCE(file->'imports', '[]'::jsonb))
        ),
        ARRAY[]::text[]
      )
    FROM jsonb_array_elements(p_files) AS file;
  END IF;

  IF p_chunks IS NOT NULL AND jsonb_typeof(p_chunks) = 'array' THEN
    INSERT INTO public.repo_chunks (
      user_id,
      repo_full_name,
      file_path,
      chunk_index,
      content,
      token_count,
      embedding,
      metadata
    )
    SELECT
      p_user_id,
      p_repo_full_name,
      chunk->>'file_path',
      COALESCE((chunk->>'chunk_index')::integer, 0),
      chunk->>'content',
      COALESCE((chunk->>'token_count')::integer, 0),
      (chunk->>'embedding')::extensions.vector,
      COALESCE(chunk->'metadata', '{}'::jsonb)
    FROM jsonb_array_elements(p_chunks) AS chunk;
  END IF;

  UPDATE public.repos
  SET
    indexed = p_indexed,
    indexing = p_indexing,
    chunk_count = COALESCE(
      p_chunk_count,
      (
        SELECT COUNT(*)
        FROM public.repo_chunks
        WHERE user_id = p_user_id
          AND repo_full_name = p_repo_full_name
      )
    ),
    last_indexed_at = p_last_indexed_at,
    last_synced_sha = COALESCE(p_last_synced_sha, last_synced_sha),
    watched_branch = COALESCE(p_watched_branch, watched_branch),
    sync_blocked_reason = p_sync_blocked_reason,
    pending_sync_head_sha = p_pending_sync_head_sha,
    updated_at = now()
  WHERE user_id = p_user_id
    AND full_name = p_repo_full_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_repo_paths(
  p_user_id uuid,
  p_repo_full_name text,
  p_remove_paths text[],
  p_files jsonb,
  p_chunks jsonb,
  p_last_synced_sha text,
  p_last_indexed_at timestamptz,
  p_chunk_count integer,
  p_sync_blocked_reason text DEFAULT NULL,
  p_pending_sync_head_sha text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_remove_paths IS NOT NULL AND array_length(p_remove_paths, 1) IS NOT NULL THEN
    DELETE FROM public.repo_chunks
    WHERE user_id = p_user_id
      AND repo_full_name = p_repo_full_name
      AND file_path = ANY(p_remove_paths);

    DELETE FROM public.repo_files
    WHERE user_id = p_user_id
      AND repo_full_name = p_repo_full_name
      AND file_path = ANY(p_remove_paths);
  END IF;

  IF p_files IS NOT NULL AND jsonb_typeof(p_files) = 'array' THEN
    INSERT INTO public.repo_files (
      user_id,
      repo_full_name,
      file_path,
      file_name,
      extension,
      line_count,
      size_bytes,
      content_hash,
      imports
    )
    SELECT
      p_user_id,
      p_repo_full_name,
      file->>'file_path',
      file->>'file_name',
      NULLIF(file->>'extension', ''),
      COALESCE((file->>'line_count')::integer, 0),
      COALESCE((file->>'size_bytes')::integer, 0),
      NULLIF(file->>'content_hash', ''),
      COALESCE(
        ARRAY(
          SELECT jsonb_array_elements_text(COALESCE(file->'imports', '[]'::jsonb))
        ),
        ARRAY[]::text[]
      )
    FROM jsonb_array_elements(p_files) AS file;
  END IF;

  IF p_chunks IS NOT NULL AND jsonb_typeof(p_chunks) = 'array' THEN
    INSERT INTO public.repo_chunks (
      user_id,
      repo_full_name,
      file_path,
      chunk_index,
      content,
      token_count,
      embedding,
      metadata
    )
    SELECT
      p_user_id,
      p_repo_full_name,
      chunk->>'file_path',
      COALESCE((chunk->>'chunk_index')::integer, 0),
      chunk->>'content',
      COALESCE((chunk->>'token_count')::integer, 0),
      (chunk->>'embedding')::extensions.vector,
      COALESCE(chunk->'metadata', '{}'::jsonb)
    FROM jsonb_array_elements(p_chunks) AS chunk;
  END IF;

  UPDATE public.repos
  SET
    last_synced_sha = p_last_synced_sha,
    chunk_count = COALESCE(
      p_chunk_count,
      (
        SELECT COUNT(*)
        FROM public.repo_chunks
        WHERE user_id = p_user_id
          AND repo_full_name = p_repo_full_name
      )
    ),
    last_indexed_at = p_last_indexed_at,
    sync_blocked_reason = p_sync_blocked_reason,
    pending_sync_head_sha = p_pending_sync_head_sha,
    updated_at = now()
  WHERE user_id = p_user_id
    AND full_name = p_repo_full_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_repo_index(
  uuid,
  text,
  jsonb,
  jsonb,
  integer,
  timestamptz,
  text,
  text,
  boolean,
  boolean,
  text,
  text
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.replace_repo_paths(
  uuid,
  text,
  text[],
  jsonb,
  jsonb,
  text,
  timestamptz,
  integer,
  text,
  text
) TO authenticated, service_role;
