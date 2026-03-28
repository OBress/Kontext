


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
    CONSTRAINT "ingestion_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'fetching'::"text", 'chunking'::"text", 'embedding'::"text", 'done'::"text", 'error'::"text"])))
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



CREATE TABLE IF NOT EXISTS "public"."repo_chunks" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "repo_full_name" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "chunk_index" integer NOT NULL,
    "content" "text" NOT NULL,
    "token_count" integer DEFAULT 0 NOT NULL,
    "embedding" "extensions"."vector"(768),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
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
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."repos" OWNER TO "postgres";


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
    "updated_at" timestamp with time zone DEFAULT "now"()
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



ALTER TABLE ONLY "public"."repo_chunks"
    ADD CONSTRAINT "repo_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repo_files"
    ADD CONSTRAINT "repo_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repo_files"
    ADD CONSTRAINT "repo_files_user_id_repo_full_name_file_path_key" UNIQUE ("user_id", "repo_full_name", "file_path");



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



ALTER TABLE ONLY "public"."user_tokens"
    ADD CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_tokens"
    ADD CONSTRAINT "user_tokens_user_id_key" UNIQUE ("user_id");



CREATE INDEX "idx_chat_sessions_user_repo" ON "public"."chat_sessions" USING "btree" ("user_id", "repo_full_name");



CREATE INDEX "idx_generated_prompts_user_repo" ON "public"."generated_prompts" USING "btree" ("user_id", "repo_full_name");



CREATE INDEX "idx_ingestion_user_repo" ON "public"."ingestion_jobs" USING "btree" ("user_id", "repo_full_name");



CREATE INDEX "idx_mcp_keys_hash" ON "public"."mcp_api_keys" USING "btree" ("key_hash");



CREATE INDEX "idx_mcp_keys_user" ON "public"."mcp_api_keys" USING "btree" ("user_id");



CREATE INDEX "idx_repo_chunks_embedding" ON "public"."repo_chunks" USING "ivfflat" ("embedding" "extensions"."vector_cosine_ops") WITH ("lists"='100');



CREATE INDEX "idx_repo_chunks_user_repo" ON "public"."repo_chunks" USING "btree" ("user_id", "repo_full_name");



CREATE INDEX "idx_repo_files_user_repo" ON "public"."repo_files" USING "btree" ("user_id", "repo_full_name");



CREATE INDEX "idx_repos_user" ON "public"."repos" USING "btree" ("user_id");



CREATE INDEX "idx_team_invites_repo" ON "public"."team_invites" USING "btree" ("repo_full_name");



CREATE INDEX "idx_team_members_repo" ON "public"."team_members" USING "btree" ("repo_full_name");



CREATE INDEX "idx_user_tokens_user" ON "public"."user_tokens" USING "btree" ("user_id");



ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."generated_prompts"
    ADD CONSTRAINT "generated_prompts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ingestion_jobs"
    ADD CONSTRAINT "ingestion_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mcp_api_keys"
    ADD CONSTRAINT "mcp_api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repo_chunks"
    ADD CONSTRAINT "repo_chunks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repo_files"
    ADD CONSTRAINT "repo_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repos"
    ADD CONSTRAINT "repos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_invites"
    ADD CONSTRAINT "team_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



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



CREATE POLICY "Users manage own chats" ON "public"."chat_sessions" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own ingestion_jobs" ON "public"."ingestion_jobs" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own mcp keys" ON "public"."mcp_api_keys" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own prompts" ON "public"."generated_prompts" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own repo_files" ON "public"."repo_files" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own repos" ON "public"."repos" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own tokens" ON "public"."user_tokens" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users see co-members" ON "public"."team_members" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."team_members" "tm"
  WHERE (("tm"."repo_full_name" = "team_members"."repo_full_name") AND ("tm"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users see own memberships" ON "public"."team_members" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."chat_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."generated_prompts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ingestion_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mcp_api_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repo_chunks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repo_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_tokens" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


















































































































































































































































































































































































































































































































GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";






























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



GRANT ALL ON TABLE "public"."repo_chunks" TO "anon";
GRANT ALL ON TABLE "public"."repo_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."repo_chunks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."repo_chunks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."repo_chunks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."repo_chunks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."repo_files" TO "anon";
GRANT ALL ON TABLE "public"."repo_files" TO "authenticated";
GRANT ALL ON TABLE "public"."repo_files" TO "service_role";



GRANT ALL ON SEQUENCE "public"."repo_files_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."repo_files_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."repo_files_id_seq" TO "service_role";



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



GRANT ALL ON TABLE "public"."user_tokens" TO "anon";
GRANT ALL ON TABLE "public"."user_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."user_tokens" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_tokens_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_tokens_id_seq" TO "service_role";









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



































