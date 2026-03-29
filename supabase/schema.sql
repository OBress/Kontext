


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."hybrid_match_chunks"("query_text" "text", "query_embedding" "extensions"."vector", "match_count" integer DEFAULT 25, "filter_repo" "text" DEFAULT NULL::"text", "filter_user_id" "uuid" DEFAULT NULL::"uuid", "full_text_weight" double precision DEFAULT 1.0, "semantic_weight" double precision DEFAULT 1.0, "rrf_k" integer DEFAULT 60) RETURNS TABLE("id" bigint, "file_path" "text", "content" "text", "similarity" double precision)
    LANGUAGE "sql" STABLE
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


ALTER FUNCTION "public"."hybrid_match_chunks"("query_text" "text", "query_embedding" "extensions"."vector", "match_count" integer, "filter_repo" "text", "filter_user_id" "uuid", "full_text_weight" double precision, "semantic_weight" double precision, "rrf_k" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_chunks"("query_embedding" "extensions"."vector", "match_count" integer DEFAULT 5, "filter_repo" "text" DEFAULT NULL::"text", "filter_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" bigint, "file_path" "text", "content" "text", "similarity" double precision)
    LANGUAGE "plpgsql"
    AS $$
begin
  return query
  select
    rc.id,
    rc.file_path,
    rc.content,
    1 - (rc.embedding <=> query_embedding) as similarity
  from public.repo_chunks rc
  where
    (filter_user_id is null or rc.user_id = filter_user_id)
    and (filter_repo is null or rc.repo_full_name = filter_repo)
  order by rc.embedding <=> query_embedding
  limit match_count;
end;
$$;


ALTER FUNCTION "public"."match_chunks"("query_embedding" "extensions"."vector", "match_count" integer, "filter_repo" "text", "filter_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_timeline"("query_embedding" "extensions"."vector", "match_count" integer DEFAULT 5, "filter_repo" "text" DEFAULT NULL::"text", "filter_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" bigint, "sha" "text", "message" "text", "ai_summary" "text", "author_name" "text", "author_avatar_url" "text", "committed_at" timestamp with time zone, "push_group_id" "text", "files_changed" "jsonb", "similarity" double precision)
    LANGUAGE "plpgsql"
    AS $$
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


ALTER FUNCTION "public"."match_timeline"("query_embedding" "extensions"."vector", "match_count" integer, "filter_repo" "text", "filter_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_repo_index"("p_user_id" "uuid", "p_repo_full_name" "text", "p_files" "jsonb", "p_chunks" "jsonb", "p_chunk_count" integer, "p_last_indexed_at" timestamp with time zone, "p_last_synced_sha" "text" DEFAULT NULL::"text", "p_watched_branch" "text" DEFAULT NULL::"text", "p_indexed" boolean DEFAULT true, "p_indexing" boolean DEFAULT false, "p_sync_blocked_reason" "text" DEFAULT NULL::"text", "p_pending_sync_head_sha" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."replace_repo_index"("p_user_id" "uuid", "p_repo_full_name" "text", "p_files" "jsonb", "p_chunks" "jsonb", "p_chunk_count" integer, "p_last_indexed_at" timestamp with time zone, "p_last_synced_sha" "text", "p_watched_branch" "text", "p_indexed" boolean, "p_indexing" boolean, "p_sync_blocked_reason" "text", "p_pending_sync_head_sha" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_repo_paths"("p_user_id" "uuid", "p_repo_full_name" "text", "p_remove_paths" "text"[], "p_files" "jsonb", "p_chunks" "jsonb", "p_last_synced_sha" "text", "p_last_indexed_at" timestamp with time zone, "p_chunk_count" integer, "p_sync_blocked_reason" "text" DEFAULT NULL::"text", "p_pending_sync_head_sha" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."replace_repo_paths"("p_user_id" "uuid", "p_repo_full_name" "text", "p_remove_paths" "text"[], "p_files" "jsonb", "p_chunks" "jsonb", "p_last_synced_sha" "text", "p_last_indexed_at" timestamp with time zone, "p_chunk_count" integer, "p_sync_blocked_reason" "text", "p_pending_sync_head_sha" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activity_events" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text",
    "source" "text" DEFAULT 'kontext'::"text" NOT NULL,
    "event_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "activity_events_source_check" CHECK (("source" = ANY (ARRAY['kontext'::"text", 'github'::"text"]))),
    CONSTRAINT "activity_events_type_check" CHECK (("event_type" = ANY (ARRAY['repo_added'::"text", 'repo_deleted'::"text", 'repo_indexed'::"text", 'repo_synced'::"text", 'team_member_joined'::"text", 'team_invite_sent'::"text", 'chat_session'::"text", 'prompt_generated'::"text", 'push'::"text", 'pull_request'::"text", 'issue'::"text", 'create'::"text", 'release'::"text", 'workflow_run'::"text", 'repo_check_completed'::"text"])))
);


ALTER TABLE "public"."activity_events" OWNER TO "postgres";


ALTER TABLE "public"."activity_events" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."activity_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."chat_sessions" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "messages" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."chat_sessions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."chat_sessions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."chat_sessions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."chat_sessions_id_seq" OWNED BY "public"."chat_sessions"."id";



CREATE TABLE IF NOT EXISTS "public"."generated_prompts" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "target" "text" DEFAULT 'cursor'::"text" NOT NULL,
    "detected_stack" "jsonb" DEFAULT '[]'::"jsonb",
    "prompt_text" "text" NOT NULL,
    "custom_instructions" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."generated_prompts" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."generated_prompts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."generated_prompts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."generated_prompts_id_seq" OWNED BY "public"."generated_prompts"."id";



CREATE TABLE IF NOT EXISTS "public"."ingestion_jobs" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "files_total" integer DEFAULT 0,
    "files_processed" integer DEFAULT 0,
    "chunks_created" integer DEFAULT 0,
    "error_message" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "ingestion_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'fetching'::"text", 'chunking'::"text", 'embedding'::"text", 'finalizing'::"text", 'timeline'::"text", 'done'::"text", 'blocked_quota'::"text", 'blocked_billing'::"text", 'blocked_model'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."ingestion_jobs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ingestion_jobs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ingestion_jobs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ingestion_jobs_id_seq" OWNED BY "public"."ingestion_jobs"."id";



CREATE TABLE IF NOT EXISTS "public"."mcp_api_keys" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "key_prefix" "text" NOT NULL,
    "key_hash" "text" NOT NULL,
    "repo_full_name" "text",
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone
);


ALTER TABLE "public"."mcp_api_keys" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."mcp_api_keys_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."mcp_api_keys_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."mcp_api_keys_id_seq" OWNED BY "public"."mcp_api_keys"."id";



CREATE TABLE IF NOT EXISTS "public"."onboarding_assignments" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "template_id" bigint,
    "template_version_id" bigint,
    "invite_id" bigint,
    "assignee_user_id" "uuid",
    "assignee_github_username" "text",
    "assigned_by" "uuid",
    "role_target" "text" DEFAULT 'member'::"text" NOT NULL,
    "status" "text" DEFAULT 'assigned'::"text" NOT NULL,
    "progress_percent" integer DEFAULT 0 NOT NULL,
    "current_step" integer DEFAULT 0 NOT NULL,
    "score" numeric(5,2),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "onboarding_assignments_progress_check" CHECK ((("progress_percent" >= 0) AND ("progress_percent" <= 100))),
    CONSTRAINT "onboarding_assignments_role_check" CHECK (("role_target" = ANY (ARRAY['admin'::"text", 'member'::"text", 'viewer'::"text"]))),
    CONSTRAINT "onboarding_assignments_status_check" CHECK (("status" = ANY (ARRAY['assigned'::"text", 'in_progress'::"text", 'completed'::"text", 'overdue'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."onboarding_assignments" OWNER TO "postgres";


ALTER TABLE "public"."onboarding_assignments" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."onboarding_assignments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."onboarding_step_attempts" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "assignment_id" bigint NOT NULL,
    "step_order" integer NOT NULL,
    "step_title" "text",
    "attempt_number" integer DEFAULT 1 NOT NULL,
    "passed" boolean DEFAULT false NOT NULL,
    "score" numeric(5,2),
    "response" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "onboarding_step_attempts_attempt_check" CHECK (("attempt_number" >= 1))
);


ALTER TABLE "public"."onboarding_step_attempts" OWNER TO "postgres";


ALTER TABLE "public"."onboarding_step_attempts" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."onboarding_step_attempts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."onboarding_template_steps" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "template_id" bigint NOT NULL,
    "step_order" integer NOT NULL,
    "step_type" "text" DEFAULT 'content'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "content" "text",
    "quiz_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "onboarding_template_steps_type_check" CHECK (("step_type" = ANY (ARRAY['content'::"text", 'guided_explore'::"text", 'quiz'::"text", 'acknowledgement'::"text"])))
);


ALTER TABLE "public"."onboarding_template_steps" OWNER TO "postgres";


ALTER TABLE "public"."onboarding_template_steps" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."onboarding_template_steps_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."onboarding_template_versions" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "template_id" bigint NOT NULL,
    "version_number" integer NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "steps" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "step_count" integer DEFAULT 0 NOT NULL,
    "published_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."onboarding_template_versions" OWNER TO "postgres";


ALTER TABLE "public"."onboarding_template_versions" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."onboarding_template_versions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."onboarding_templates" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "title" "text" DEFAULT 'Repository onboarding'::"text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "current_version" integer DEFAULT 0 NOT NULL,
    "active_version_id" bigint,
    "source_template_id" bigint,
    "created_by" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "onboarding_templates_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."onboarding_templates" OWNER TO "postgres";


ALTER TABLE "public"."onboarding_templates" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."onboarding_templates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."repo_check_configs" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "check_type" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "trigger_mode" "text" DEFAULT 'after_sync'::"text" NOT NULL,
    "notify_on_high" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "repo_check_configs_trigger_check" CHECK (("trigger_mode" = ANY (ARRAY['manual'::"text", 'after_sync'::"text", 'daily'::"text"]))),
    CONSTRAINT "repo_check_configs_type_check" CHECK (("check_type" = ANY (ARRAY['security'::"text", 'optimization'::"text", 'consistency'::"text", 'change_impact'::"text"])))
);


ALTER TABLE "public"."repo_check_configs" OWNER TO "postgres";


ALTER TABLE "public"."repo_check_configs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."repo_check_configs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."repo_check_findings" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "check_type" "text" NOT NULL,
    "fingerprint" "text" NOT NULL,
    "title" "text" NOT NULL,
    "summary" "text" NOT NULL,
    "severity" "text" DEFAULT 'medium'::"text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "transition_state" "text" DEFAULT 'new'::"text" NOT NULL,
    "confidence" double precision DEFAULT 0.5 NOT NULL,
    "category" "text",
    "file_path" "text",
    "symbol" "text",
    "evidence" "text",
    "recommendation" "text",
    "related_files" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "first_seen_sha" "text",
    "last_seen_sha" "text",
    "fixed_in_sha" "text",
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "opened_in_run_id" bigint,
    "last_run_id" bigint,
    "fixed_in_run_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "repo_check_findings_severity_check" CHECK (("severity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "repo_check_findings_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'resolved'::"text"]))),
    CONSTRAINT "repo_check_findings_transition_check" CHECK (("transition_state" = ANY (ARRAY['new'::"text", 'persistent'::"text", 'regressed'::"text", 'resolved'::"text"]))),
    CONSTRAINT "repo_check_findings_type_check" CHECK (("check_type" = ANY (ARRAY['security'::"text", 'optimization'::"text", 'consistency'::"text", 'change_impact'::"text"])))
);


ALTER TABLE "public"."repo_check_findings" OWNER TO "postgres";


ALTER TABLE "public"."repo_check_findings" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."repo_check_findings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."repo_check_runs" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "trigger_mode" "text" DEFAULT 'manual'::"text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "dedupe_key" "text",
    "requested_check_types" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "changed_files" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "base_sha" "text",
    "head_sha" "text",
    "summary" "text",
    "findings_total" integer DEFAULT 0 NOT NULL,
    "new_findings" integer DEFAULT 0 NOT NULL,
    "resolved_findings" integer DEFAULT 0 NOT NULL,
    "unchanged_findings" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error_message" "text",
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "repo_check_runs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'skipped'::"text"]))),
    CONSTRAINT "repo_check_runs_trigger_check" CHECK (("trigger_mode" = ANY (ARRAY['manual'::"text", 'after_sync'::"text", 'daily'::"text", 'mcp'::"text"])))
);


ALTER TABLE "public"."repo_check_runs" OWNER TO "postgres";


ALTER TABLE "public"."repo_check_runs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."repo_check_runs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."repo_chunks" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "chunk_index" integer NOT NULL,
    "content" "text" NOT NULL,
    "token_count" integer DEFAULT 0 NOT NULL,
    "embedding" "extensions"."vector"(1536),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "fts" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"english"'::"regconfig", "content")) STORED
);


ALTER TABLE "public"."repo_chunks" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."repo_chunks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."repo_chunks_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."repo_chunks_id_seq" OWNED BY "public"."repo_chunks"."id";



CREATE TABLE IF NOT EXISTS "public"."repo_commits" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "sha" "text" NOT NULL,
    "message" "text" NOT NULL,
    "author_name" "text",
    "author_avatar_url" "text",
    "committed_at" timestamp with time zone NOT NULL,
    "files_changed" "jsonb" DEFAULT '[]'::"jsonb",
    "sync_triggered" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "ai_summary" "text",
    "ai_summary_embedding" "extensions"."vector"(1536),
    "push_group_id" "text"
);


ALTER TABLE "public"."repo_commits" OWNER TO "postgres";


ALTER TABLE "public"."repo_commits" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."repo_commits_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."repo_files" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "extension" "text",
    "line_count" integer DEFAULT 0,
    "size_bytes" integer DEFAULT 0,
    "content_hash" "text",
    "imports" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."repo_files" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."repo_files_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."repo_files_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."repo_files_id_seq" OWNED BY "public"."repo_files"."id";



CREATE TABLE IF NOT EXISTS "public"."repo_jobs" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "job_type" "text" NOT NULL,
    "trigger" "text" DEFAULT 'manual'::"text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "title" "text",
    "progress_percent" integer DEFAULT 0 NOT NULL,
    "dedupe_key" "text",
    "result_summary" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error_message" "text",
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "repo_jobs_progress_check" CHECK ((("progress_percent" >= 0) AND ("progress_percent" <= 100))),
    CONSTRAINT "repo_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'skipped'::"text"]))),
    CONSTRAINT "repo_jobs_trigger_check" CHECK (("trigger" = ANY (ARRAY['manual'::"text", 'webhook'::"text", 'schedule'::"text", 'mcp'::"text", 'system'::"text", 'invite'::"text", 'sync'::"text"]))),
    CONSTRAINT "repo_jobs_type_check" CHECK (("job_type" = ANY (ARRAY['ingest'::"text", 'sync'::"text", 'repo_check'::"text", 'onboarding_generate'::"text", 'onboarding_assign'::"text", 'architecture_refresh'::"text"])))
);


ALTER TABLE "public"."repo_jobs" OWNER TO "postgres";


ALTER TABLE "public"."repo_jobs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."repo_jobs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."repos" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "github_id" bigint NOT NULL,
    "full_name" "text" NOT NULL,
    "name" "text" NOT NULL,
    "owner" "text" NOT NULL,
    "description" "text",
    "language" "text",
    "stargazers_count" integer DEFAULT 0,
    "forks_count" integer DEFAULT 0,
    "default_branch" "text" DEFAULT 'main'::"text",
    "indexed" boolean DEFAULT false,
    "indexing" boolean DEFAULT false,
    "chunk_count" integer DEFAULT 0,
    "last_indexed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "last_synced_sha" "text",
    "watched_branch" "text",
    "auto_sync_enabled" boolean DEFAULT false,
    "understanding_tier" smallint DEFAULT 2,
    "webhook_id" bigint,
    "custom_github_token" "text",
    "custom_token_iv" "text",
    "custom_token_tag" "text",
    "sync_blocked_reason" "text",
    "pending_sync_head_sha" "text",
    "architecture_analysis" "jsonb",
    "architecture_analyzed_at" timestamp with time zone,
    "architecture_status" "text" DEFAULT 'missing'::"text",
    "architecture_for_sha" "text",
    "architecture_error" "text"
);


ALTER TABLE "public"."repos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."repos"."architecture_analysis" IS 'Cached AI architectural analysis (components, connections, descriptions)';



COMMENT ON COLUMN "public"."repos"."architecture_analyzed_at" IS 'Timestamp of last AI architecture analysis';



COMMENT ON COLUMN "public"."repos"."architecture_status" IS 'Freshness/status of the cached architecture bundle.';



COMMENT ON COLUMN "public"."repos"."architecture_for_sha" IS 'Commit SHA the cached architecture bundle was generated from.';



COMMENT ON COLUMN "public"."repos"."architecture_error" IS 'Last non-fatal architecture refresh error shown in the UI.';



CREATE SEQUENCE IF NOT EXISTS "public"."repos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."repos_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."repos_id_seq" OWNED BY "public"."repos"."id";



CREATE TABLE IF NOT EXISTS "public"."team_invites" (
    "id" bigint NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "github_username" "text" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval),
    "onboarding_template_version_id" bigint,
    CONSTRAINT "team_invites_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'member'::"text", 'viewer'::"text"]))),
    CONSTRAINT "team_invites_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'rejected'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."team_invites" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."team_invites_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."team_invites_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."team_invites_id_seq" OWNED BY "public"."team_invites"."id";



CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "id" bigint NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "invited_by" "uuid",
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "onboarding_completed" boolean DEFAULT false,
    "onboarding_step" integer DEFAULT 0,
    "joined_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "team_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."team_members" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."team_members_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."team_members_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."team_members_id_seq" OWNED BY "public"."team_members"."id";



CREATE TABLE IF NOT EXISTS "public"."user_preferences" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "activity_filters" "jsonb" DEFAULT '{"push": true, "issue": true, "create": true, "release": true, "repo_added": true, "repo_synced": true, "pull_request": true, "repo_deleted": true, "repo_indexed": true, "workflow_run": true, "team_invite_sent": true, "team_member_joined": true}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_preferences" OWNER TO "postgres";


ALTER TABLE "public"."user_preferences" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."user_preferences_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."user_tokens" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "provider" "text" DEFAULT 'github'::"text" NOT NULL,
    "encrypted_token" "text" NOT NULL,
    "token_iv" "text" NOT NULL,
    "token_tag" "text" NOT NULL,
    "refresh_token" "text",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "encrypted_ai_key" "text",
    "ai_key_iv" "text",
    "ai_key_tag" "text"
);


ALTER TABLE "public"."user_tokens" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."user_tokens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."user_tokens_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."user_tokens_id_seq" OWNED BY "public"."user_tokens"."id";



CREATE TABLE IF NOT EXISTS "public"."webhook_events" (
    "id" bigint NOT NULL,
    "delivery_id" "text" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "processed" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."webhook_events" OWNER TO "postgres";


ALTER TABLE "public"."webhook_events" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."webhook_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."chat_sessions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."chat_sessions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."generated_prompts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."generated_prompts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ingestion_jobs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ingestion_jobs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."mcp_api_keys" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."mcp_api_keys_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."repo_chunks" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."repo_chunks_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."repo_files" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."repo_files_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."repos" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."repos_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."team_invites" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."team_invites_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."team_members" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."team_members_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."user_tokens" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."user_tokens_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."activity_events"
    ADD CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."generated_prompts"
    ADD CONSTRAINT "generated_prompts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ingestion_jobs"
    ADD CONSTRAINT "ingestion_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mcp_api_keys"
    ADD CONSTRAINT "mcp_api_keys_key_hash_key" UNIQUE ("key_hash");



ALTER TABLE ONLY "public"."mcp_api_keys"
    ADD CONSTRAINT "mcp_api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."onboarding_assignments"
    ADD CONSTRAINT "onboarding_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."onboarding_assignments"
    ADD CONSTRAINT "onboarding_assignments_user_id_repo_full_name_invite_id_key" UNIQUE ("user_id", "repo_full_name", "invite_id");



ALTER TABLE ONLY "public"."onboarding_step_attempts"
    ADD CONSTRAINT "onboarding_step_attempts_assignment_id_step_order_attempt_n_key" UNIQUE ("assignment_id", "step_order", "attempt_number");



ALTER TABLE ONLY "public"."onboarding_step_attempts"
    ADD CONSTRAINT "onboarding_step_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."onboarding_template_steps"
    ADD CONSTRAINT "onboarding_template_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."onboarding_template_steps"
    ADD CONSTRAINT "onboarding_template_steps_template_id_step_order_key" UNIQUE ("template_id", "step_order");



ALTER TABLE ONLY "public"."onboarding_template_versions"
    ADD CONSTRAINT "onboarding_template_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."onboarding_template_versions"
    ADD CONSTRAINT "onboarding_template_versions_template_id_version_number_key" UNIQUE ("template_id", "version_number");



ALTER TABLE ONLY "public"."onboarding_templates"
    ADD CONSTRAINT "onboarding_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repo_check_configs"
    ADD CONSTRAINT "repo_check_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repo_check_configs"
    ADD CONSTRAINT "repo_check_configs_user_id_repo_full_name_check_type_key" UNIQUE ("user_id", "repo_full_name", "check_type");



ALTER TABLE ONLY "public"."repo_check_findings"
    ADD CONSTRAINT "repo_check_findings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repo_check_findings"
    ADD CONSTRAINT "repo_check_findings_user_id_repo_full_name_check_type_finge_key" UNIQUE ("user_id", "repo_full_name", "check_type", "fingerprint");



ALTER TABLE ONLY "public"."repo_check_runs"
    ADD CONSTRAINT "repo_check_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repo_check_runs"
    ADD CONSTRAINT "repo_check_runs_user_id_dedupe_key_key" UNIQUE ("user_id", "dedupe_key");



ALTER TABLE ONLY "public"."repo_chunks"
    ADD CONSTRAINT "repo_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repo_commits"
    ADD CONSTRAINT "repo_commits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repo_commits"
    ADD CONSTRAINT "repo_commits_user_id_repo_full_name_sha_key" UNIQUE ("user_id", "repo_full_name", "sha");



ALTER TABLE ONLY "public"."repo_files"
    ADD CONSTRAINT "repo_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repo_files"
    ADD CONSTRAINT "repo_files_user_id_repo_full_name_file_path_key" UNIQUE ("user_id", "repo_full_name", "file_path");



ALTER TABLE ONLY "public"."repo_jobs"
    ADD CONSTRAINT "repo_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repo_jobs"
    ADD CONSTRAINT "repo_jobs_user_id_dedupe_key_key" UNIQUE ("user_id", "dedupe_key");



ALTER TABLE ONLY "public"."repos"
    ADD CONSTRAINT "repos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repos"
    ADD CONSTRAINT "repos_user_id_full_name_key" UNIQUE ("user_id", "full_name");



ALTER TABLE ONLY "public"."team_invites"
    ADD CONSTRAINT "team_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_repo_full_name_user_id_key" UNIQUE ("repo_full_name", "user_id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."user_tokens"
    ADD CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_tokens"
    ADD CONSTRAINT "user_tokens_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."webhook_events"
    ADD CONSTRAINT "webhook_events_delivery_id_key" UNIQUE ("delivery_id");



ALTER TABLE ONLY "public"."webhook_events"
    ADD CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_activity_events_user_created" ON "public"."activity_events" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_activity_events_user_source" ON "public"."activity_events" USING "btree" ("user_id", "source");



CREATE INDEX "idx_chat_sessions_user_repo" ON "public"."chat_sessions" USING "btree" ("user_id", "repo_full_name");



CREATE INDEX "idx_generated_prompts_user_repo" ON "public"."generated_prompts" USING "btree" ("user_id", "repo_full_name");



CREATE INDEX "idx_ingestion_user_repo" ON "public"."ingestion_jobs" USING "btree" ("user_id", "repo_full_name");



CREATE INDEX "idx_mcp_keys_hash" ON "public"."mcp_api_keys" USING "btree" ("key_hash");



CREATE INDEX "idx_mcp_keys_user" ON "public"."mcp_api_keys" USING "btree" ("user_id");



CREATE INDEX "idx_onboarding_assignments_lookup" ON "public"."onboarding_assignments" USING "btree" ("user_id", "repo_full_name", "status", "created_at" DESC);



CREATE INDEX "idx_onboarding_attempts_lookup" ON "public"."onboarding_step_attempts" USING "btree" ("user_id", "repo_full_name", "assignment_id", "step_order");



CREATE INDEX "idx_onboarding_template_steps_lookup" ON "public"."onboarding_template_steps" USING "btree" ("user_id", "repo_full_name", "template_id", "step_order");



CREATE INDEX "idx_onboarding_templates_lookup" ON "public"."onboarding_templates" USING "btree" ("user_id", "repo_full_name", "updated_at" DESC);



CREATE INDEX "idx_onboarding_versions_lookup" ON "public"."onboarding_template_versions" USING "btree" ("user_id", "repo_full_name", "template_id", "version_number" DESC);



CREATE INDEX "idx_repo_check_configs_lookup" ON "public"."repo_check_configs" USING "btree" ("user_id", "repo_full_name");



CREATE INDEX "idx_repo_check_findings_lookup" ON "public"."repo_check_findings" USING "btree" ("user_id", "repo_full_name", "status", "severity");



CREATE INDEX "idx_repo_check_runs_lookup" ON "public"."repo_check_runs" USING "btree" ("user_id", "repo_full_name", "created_at" DESC);



CREATE INDEX "idx_repo_chunks_embedding" ON "public"."repo_chunks" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');



CREATE INDEX "idx_repo_chunks_fts" ON "public"."repo_chunks" USING "gin" ("fts");



CREATE INDEX "idx_repo_chunks_user_repo" ON "public"."repo_chunks" USING "btree" ("user_id", "repo_full_name");



CREATE INDEX "idx_repo_commits_lookup" ON "public"."repo_commits" USING "btree" ("user_id", "repo_full_name", "committed_at" DESC);



CREATE INDEX "idx_repo_commits_push_group" ON "public"."repo_commits" USING "btree" ("user_id", "repo_full_name", "push_group_id");



CREATE INDEX "idx_repo_commits_summary_embedding" ON "public"."repo_commits" USING "ivfflat" ("ai_summary_embedding" "extensions"."vector_cosine_ops") WITH ("lists"='50');



CREATE INDEX "idx_repo_files_user_repo" ON "public"."repo_files" USING "btree" ("user_id", "repo_full_name");



CREATE INDEX "idx_repo_jobs_lookup" ON "public"."repo_jobs" USING "btree" ("user_id", "repo_full_name", "created_at" DESC);



CREATE INDEX "idx_repos_user" ON "public"."repos" USING "btree" ("user_id");



CREATE INDEX "idx_team_invites_repo" ON "public"."team_invites" USING "btree" ("repo_full_name");



CREATE INDEX "idx_team_members_repo" ON "public"."team_members" USING "btree" ("repo_full_name");



CREATE INDEX "idx_user_tokens_user" ON "public"."user_tokens" USING "btree" ("user_id");



ALTER TABLE ONLY "public"."activity_events"
    ADD CONSTRAINT "activity_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."generated_prompts"
    ADD CONSTRAINT "generated_prompts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ingestion_jobs"
    ADD CONSTRAINT "ingestion_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mcp_api_keys"
    ADD CONSTRAINT "mcp_api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."onboarding_assignments"
    ADD CONSTRAINT "onboarding_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."onboarding_assignments"
    ADD CONSTRAINT "onboarding_assignments_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."onboarding_assignments"
    ADD CONSTRAINT "onboarding_assignments_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "public"."team_invites"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."onboarding_assignments"
    ADD CONSTRAINT "onboarding_assignments_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."onboarding_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."onboarding_assignments"
    ADD CONSTRAINT "onboarding_assignments_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "public"."onboarding_template_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."onboarding_assignments"
    ADD CONSTRAINT "onboarding_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."onboarding_step_attempts"
    ADD CONSTRAINT "onboarding_step_attempts_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."onboarding_assignments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."onboarding_step_attempts"
    ADD CONSTRAINT "onboarding_step_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."onboarding_template_steps"
    ADD CONSTRAINT "onboarding_template_steps_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."onboarding_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."onboarding_template_steps"
    ADD CONSTRAINT "onboarding_template_steps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."onboarding_template_versions"
    ADD CONSTRAINT "onboarding_template_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."onboarding_template_versions"
    ADD CONSTRAINT "onboarding_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."onboarding_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."onboarding_template_versions"
    ADD CONSTRAINT "onboarding_template_versions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."onboarding_templates"
    ADD CONSTRAINT "onboarding_templates_active_version_id_fkey" FOREIGN KEY ("active_version_id") REFERENCES "public"."onboarding_template_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."onboarding_templates"
    ADD CONSTRAINT "onboarding_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."onboarding_templates"
    ADD CONSTRAINT "onboarding_templates_source_template_id_fkey" FOREIGN KEY ("source_template_id") REFERENCES "public"."onboarding_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."onboarding_templates"
    ADD CONSTRAINT "onboarding_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repo_check_configs"
    ADD CONSTRAINT "repo_check_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repo_check_findings"
    ADD CONSTRAINT "repo_check_findings_fixed_in_run_id_fkey" FOREIGN KEY ("fixed_in_run_id") REFERENCES "public"."repo_check_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."repo_check_findings"
    ADD CONSTRAINT "repo_check_findings_last_run_id_fkey" FOREIGN KEY ("last_run_id") REFERENCES "public"."repo_check_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."repo_check_findings"
    ADD CONSTRAINT "repo_check_findings_opened_in_run_id_fkey" FOREIGN KEY ("opened_in_run_id") REFERENCES "public"."repo_check_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."repo_check_findings"
    ADD CONSTRAINT "repo_check_findings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repo_check_runs"
    ADD CONSTRAINT "repo_check_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repo_chunks"
    ADD CONSTRAINT "repo_chunks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repo_commits"
    ADD CONSTRAINT "repo_commits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repo_files"
    ADD CONSTRAINT "repo_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repo_jobs"
    ADD CONSTRAINT "repo_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repos"
    ADD CONSTRAINT "repos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_invites"
    ADD CONSTRAINT "team_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_invites"
    ADD CONSTRAINT "team_invites_onboarding_template_version_id_fkey" FOREIGN KEY ("onboarding_template_version_id") REFERENCES "public"."onboarding_template_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_tokens"
    ADD CONSTRAINT "user_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Inviters manage invites" ON "public"."team_invites" USING (("auth"."uid"() = "invited_by")) WITH CHECK (("auth"."uid"() = "invited_by"));



CREATE POLICY "Owners/admins delete team" ON "public"."team_members" FOR DELETE USING ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."team_members" "tm"
  WHERE (("tm"."repo_full_name" = "team_members"."repo_full_name") AND ("tm"."user_id" = "auth"."uid"()) AND ("tm"."role" = ANY (ARRAY['owner'::"text", 'admin'::"text"])))))));



CREATE POLICY "Owners/admins manage team" ON "public"."team_members" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."team_members" "tm"
  WHERE (("tm"."repo_full_name" = "team_members"."repo_full_name") AND ("tm"."user_id" = "auth"."uid"()) AND ("tm"."role" = ANY (ARRAY['owner'::"text", 'admin'::"text"])))))));



CREATE POLICY "Owners/admins update team" ON "public"."team_members" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."team_members" "tm"
  WHERE (("tm"."repo_full_name" = "team_members"."repo_full_name") AND ("tm"."user_id" = "auth"."uid"()) AND ("tm"."role" = ANY (ARRAY['owner'::"text", 'admin'::"text"]))))));



CREATE POLICY "Users can delete their own chunks" ON "public"."repo_chunks" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own chunks" ON "public"."repo_chunks" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own chunks" ON "public"."repo_chunks" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own chunks" ON "public"."repo_chunks" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own activity" ON "public"."activity_events" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own chats" ON "public"."chat_sessions" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own commits" ON "public"."repo_commits" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own ingestion_jobs" ON "public"."ingestion_jobs" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own mcp keys" ON "public"."mcp_api_keys" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own onboarding assignments" ON "public"."onboarding_assignments" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own onboarding attempts" ON "public"."onboarding_step_attempts" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own onboarding steps" ON "public"."onboarding_template_steps" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own onboarding templates" ON "public"."onboarding_templates" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own onboarding versions" ON "public"."onboarding_template_versions" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own preferences" ON "public"."user_preferences" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own prompts" ON "public"."generated_prompts" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own repo check configs" ON "public"."repo_check_configs" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own repo check findings" ON "public"."repo_check_findings" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own repo check runs" ON "public"."repo_check_runs" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own repo jobs" ON "public"."repo_jobs" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own repo_files" ON "public"."repo_files" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own repos" ON "public"."repos" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own tokens" ON "public"."user_tokens" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users see co-members" ON "public"."team_members" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."team_members" "tm"
  WHERE (("tm"."repo_full_name" = "team_members"."repo_full_name") AND ("tm"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users see own memberships" ON "public"."team_members" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."activity_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."generated_prompts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ingestion_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mcp_api_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."onboarding_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."onboarding_step_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."onboarding_template_steps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."onboarding_template_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."onboarding_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repo_check_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repo_check_findings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repo_check_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repo_chunks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repo_commits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repo_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repo_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhook_events" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."activity_events";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
























































































































































































































































































































































































































































































































GRANT ALL ON FUNCTION "public"."replace_repo_index"("p_user_id" "uuid", "p_repo_full_name" "text", "p_files" "jsonb", "p_chunks" "jsonb", "p_chunk_count" integer, "p_last_indexed_at" timestamp with time zone, "p_last_synced_sha" "text", "p_watched_branch" "text", "p_indexed" boolean, "p_indexing" boolean, "p_sync_blocked_reason" "text", "p_pending_sync_head_sha" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."replace_repo_index"("p_user_id" "uuid", "p_repo_full_name" "text", "p_files" "jsonb", "p_chunks" "jsonb", "p_chunk_count" integer, "p_last_indexed_at" timestamp with time zone, "p_last_synced_sha" "text", "p_watched_branch" "text", "p_indexed" boolean, "p_indexing" boolean, "p_sync_blocked_reason" "text", "p_pending_sync_head_sha" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace_repo_index"("p_user_id" "uuid", "p_repo_full_name" "text", "p_files" "jsonb", "p_chunks" "jsonb", "p_chunk_count" integer, "p_last_indexed_at" timestamp with time zone, "p_last_synced_sha" "text", "p_watched_branch" "text", "p_indexed" boolean, "p_indexing" boolean, "p_sync_blocked_reason" "text", "p_pending_sync_head_sha" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."replace_repo_paths"("p_user_id" "uuid", "p_repo_full_name" "text", "p_remove_paths" "text"[], "p_files" "jsonb", "p_chunks" "jsonb", "p_last_synced_sha" "text", "p_last_indexed_at" timestamp with time zone, "p_chunk_count" integer, "p_sync_blocked_reason" "text", "p_pending_sync_head_sha" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."replace_repo_paths"("p_user_id" "uuid", "p_repo_full_name" "text", "p_remove_paths" "text"[], "p_files" "jsonb", "p_chunks" "jsonb", "p_last_synced_sha" "text", "p_last_indexed_at" timestamp with time zone, "p_chunk_count" integer, "p_sync_blocked_reason" "text", "p_pending_sync_head_sha" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace_repo_paths"("p_user_id" "uuid", "p_repo_full_name" "text", "p_remove_paths" "text"[], "p_files" "jsonb", "p_chunks" "jsonb", "p_last_synced_sha" "text", "p_last_indexed_at" timestamp with time zone, "p_chunk_count" integer, "p_sync_blocked_reason" "text", "p_pending_sync_head_sha" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";






























GRANT ALL ON TABLE "public"."activity_events" TO "anon";
GRANT ALL ON TABLE "public"."activity_events" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."activity_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."activity_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."activity_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."chat_sessions" TO "anon";
GRANT ALL ON TABLE "public"."chat_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_sessions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."chat_sessions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."chat_sessions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."chat_sessions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."generated_prompts" TO "anon";
GRANT ALL ON TABLE "public"."generated_prompts" TO "authenticated";
GRANT ALL ON TABLE "public"."generated_prompts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."generated_prompts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."generated_prompts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."generated_prompts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ingestion_jobs" TO "anon";
GRANT ALL ON TABLE "public"."ingestion_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."ingestion_jobs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ingestion_jobs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ingestion_jobs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ingestion_jobs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."mcp_api_keys" TO "anon";
GRANT ALL ON TABLE "public"."mcp_api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."mcp_api_keys" TO "service_role";



GRANT ALL ON SEQUENCE "public"."mcp_api_keys_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."mcp_api_keys_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."mcp_api_keys_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."onboarding_assignments" TO "anon";
GRANT ALL ON TABLE "public"."onboarding_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."onboarding_assignments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."onboarding_assignments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."onboarding_assignments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."onboarding_assignments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."onboarding_step_attempts" TO "anon";
GRANT ALL ON TABLE "public"."onboarding_step_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."onboarding_step_attempts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."onboarding_step_attempts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."onboarding_step_attempts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."onboarding_step_attempts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."onboarding_template_steps" TO "anon";
GRANT ALL ON TABLE "public"."onboarding_template_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."onboarding_template_steps" TO "service_role";



GRANT ALL ON SEQUENCE "public"."onboarding_template_steps_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."onboarding_template_steps_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."onboarding_template_steps_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."onboarding_template_versions" TO "anon";
GRANT ALL ON TABLE "public"."onboarding_template_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."onboarding_template_versions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."onboarding_template_versions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."onboarding_template_versions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."onboarding_template_versions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."onboarding_templates" TO "anon";
GRANT ALL ON TABLE "public"."onboarding_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."onboarding_templates" TO "service_role";



GRANT ALL ON SEQUENCE "public"."onboarding_templates_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."onboarding_templates_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."onboarding_templates_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."repo_check_configs" TO "anon";
GRANT ALL ON TABLE "public"."repo_check_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."repo_check_configs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."repo_check_configs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."repo_check_configs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."repo_check_configs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."repo_check_findings" TO "anon";
GRANT ALL ON TABLE "public"."repo_check_findings" TO "authenticated";
GRANT ALL ON TABLE "public"."repo_check_findings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."repo_check_findings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."repo_check_findings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."repo_check_findings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."repo_check_runs" TO "anon";
GRANT ALL ON TABLE "public"."repo_check_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."repo_check_runs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."repo_check_runs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."repo_check_runs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."repo_check_runs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."repo_chunks" TO "anon";
GRANT ALL ON TABLE "public"."repo_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."repo_chunks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."repo_chunks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."repo_chunks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."repo_chunks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."repo_commits" TO "anon";
GRANT ALL ON TABLE "public"."repo_commits" TO "authenticated";
GRANT ALL ON TABLE "public"."repo_commits" TO "service_role";



GRANT ALL ON SEQUENCE "public"."repo_commits_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."repo_commits_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."repo_commits_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."repo_files" TO "anon";
GRANT ALL ON TABLE "public"."repo_files" TO "authenticated";
GRANT ALL ON TABLE "public"."repo_files" TO "service_role";



GRANT ALL ON SEQUENCE "public"."repo_files_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."repo_files_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."repo_files_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."repo_jobs" TO "anon";
GRANT ALL ON TABLE "public"."repo_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."repo_jobs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."repo_jobs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."repo_jobs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."repo_jobs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."repos" TO "anon";
GRANT ALL ON TABLE "public"."repos" TO "authenticated";
GRANT ALL ON TABLE "public"."repos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."repos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."repos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."repos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."team_invites" TO "anon";
GRANT ALL ON TABLE "public"."team_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."team_invites" TO "service_role";



GRANT ALL ON SEQUENCE "public"."team_invites_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."team_invites_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."team_invites_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."team_members" TO "anon";
GRANT ALL ON TABLE "public"."team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."team_members" TO "service_role";



GRANT ALL ON SEQUENCE "public"."team_members_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."team_members_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."team_members_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_preferences" TO "anon";
GRANT ALL ON TABLE "public"."user_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_preferences" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_preferences_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_preferences_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_preferences_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_tokens" TO "anon";
GRANT ALL ON TABLE "public"."user_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."user_tokens" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_tokens_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_tokens_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_events" TO "anon";
GRANT ALL ON TABLE "public"."webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."webhook_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."webhook_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."webhook_events_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































