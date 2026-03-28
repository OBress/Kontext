-- ============================================================
-- Kontext Backend Schema — v2
-- Tables: repos, repo_files, ingestion_jobs, user_tokens,
--         team_members, team_invites, generated_prompts,
--         chat_sessions, mcp_api_keys
-- All with RLS policies, indexes, and cascade deletes
-- ============================================================

-- 1. Repos table (tracks which repos a user has connected)
create table public.repos (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  github_id bigint not null,
  full_name text not null,
  name text not null,
  owner text not null,
  description text,
  language text,
  stargazers_count int default 0,
  forks_count int default 0,
  default_branch text default 'main',
  indexed boolean default false,
  indexing boolean default false,
  chunk_count int default 0,
  last_indexed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, full_name)
);

-- 2. Repo files (cached file tree for graph generation)
create table public.repo_files (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  repo_full_name text not null,
  file_path text not null,
  file_name text not null,
  extension text,
  line_count int default 0,
  size_bytes int default 0,
  content_hash text,
  imports text[] default '{}',
  created_at timestamptz default now(),
  unique(user_id, repo_full_name, file_path)
);

-- 3. Ingestion jobs (tracks progress of repo indexing)
create table public.ingestion_jobs (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  repo_full_name text not null,
  status text not null default 'pending'
    check (status in ('pending','fetching','chunking','embedding','done','error')),
  files_total int default 0,
  files_processed int default 0,
  chunks_created int default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now()
);

-- 4. User tokens (encrypted GitHub provider tokens)
create table public.user_tokens (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  provider text not null default 'github',
  encrypted_token text not null,
  token_iv text not null,
  token_tag text not null,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 5. Team members
create table public.team_members (
  id bigserial primary key,
  repo_full_name text not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  invited_by uuid references auth.users(id),
  role text not null default 'member'
    check (role in ('owner','admin','member','viewer')),
  onboarding_completed boolean default false,
  onboarding_step int default 0,
  joined_at timestamptz default now(),
  unique(repo_full_name, user_id)
);

-- 6. Team invites
create table public.team_invites (
  id bigserial primary key,
  repo_full_name text not null,
  invited_by uuid references auth.users(id) on delete cascade not null,
  github_username text not null,
  role text not null default 'member'
    check (role in ('admin','member','viewer')),
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected','expired')),
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '7 days')
);

-- 7. Generated prompts (cached outputs)
create table public.generated_prompts (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  repo_full_name text not null,
  target text not null default 'cursor',
  detected_stack jsonb default '[]'::jsonb,
  prompt_text text not null,
  custom_instructions text,
  created_at timestamptz default now()
);

-- 8. Chat sessions (persistent chat history)
create table public.chat_sessions (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  repo_full_name text not null,
  messages jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 9. MCP API keys (user-generated tokens for external AI agents)
create table public.mcp_api_keys (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  key_prefix text not null,        -- first 8 chars for display "kt_a3f8..."
  key_hash text not null unique,   -- SHA-256 hash of full key
  repo_full_name text,             -- optional: scope to specific repo
  last_used_at timestamptz,
  created_at timestamptz default now(),
  expires_at timestamptz
);

-- ============================================================
-- Indexes
-- ============================================================
create index idx_repos_user on public.repos(user_id);
create index idx_repo_files_user_repo on public.repo_files(user_id, repo_full_name);
create index idx_ingestion_user_repo on public.ingestion_jobs(user_id, repo_full_name);
create index idx_user_tokens_user on public.user_tokens(user_id);
create index idx_team_members_repo on public.team_members(repo_full_name);
create index idx_team_invites_repo on public.team_invites(repo_full_name);
create index idx_generated_prompts_user_repo on public.generated_prompts(user_id, repo_full_name);
create index idx_chat_sessions_user_repo on public.chat_sessions(user_id, repo_full_name);
create index idx_mcp_keys_user on public.mcp_api_keys(user_id);
create index idx_mcp_keys_hash on public.mcp_api_keys(key_hash);

-- ============================================================
-- Row Level Security
-- ============================================================

-- repos
alter table public.repos enable row level security;
create policy "Users manage own repos" on public.repos for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- repo_files
alter table public.repo_files enable row level security;
create policy "Users manage own repo_files" on public.repo_files for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ingestion_jobs
alter table public.ingestion_jobs enable row level security;
create policy "Users manage own ingestion_jobs" on public.ingestion_jobs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- user_tokens
alter table public.user_tokens enable row level security;
create policy "Users manage own tokens" on public.user_tokens for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- team_members (users see their own memberships)
alter table public.team_members enable row level security;
create policy "Users see own memberships" on public.team_members for select
  using (auth.uid() = user_id);
create policy "Users see co-members" on public.team_members for select
  using (
    exists (
      select 1 from public.team_members tm
      where tm.repo_full_name = team_members.repo_full_name
        and tm.user_id = auth.uid()
    )
  );
create policy "Owners/admins manage team" on public.team_members for insert
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.team_members tm
      where tm.repo_full_name = team_members.repo_full_name
        and tm.user_id = auth.uid()
        and tm.role in ('owner', 'admin')
    )
  );
create policy "Owners/admins update team" on public.team_members for update
  using (
    exists (
      select 1 from public.team_members tm
      where tm.repo_full_name = team_members.repo_full_name
        and tm.user_id = auth.uid()
        and tm.role in ('owner', 'admin')
    )
  );
create policy "Owners/admins delete team" on public.team_members for delete
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.team_members tm
      where tm.repo_full_name = team_members.repo_full_name
        and tm.user_id = auth.uid()
        and tm.role in ('owner', 'admin')
    )
  );

-- team_invites
alter table public.team_invites enable row level security;
create policy "Inviters manage invites" on public.team_invites for all
  using (auth.uid() = invited_by) with check (auth.uid() = invited_by);

-- generated_prompts
alter table public.generated_prompts enable row level security;
create policy "Users manage own prompts" on public.generated_prompts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- chat_sessions
alter table public.chat_sessions enable row level security;
create policy "Users manage own chats" on public.chat_sessions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- mcp_api_keys
alter table public.mcp_api_keys enable row level security;
create policy "Users manage own mcp keys" on public.mcp_api_keys for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
