-- ============================================================
-- Kontext (RepoLens) — Initial Schema
-- Enables pgvector, creates repo_chunks table with RLS,
-- and a match_chunks similarity-search RPC function.
-- ============================================================

-- 1. Enable pgvector extension
create extension if not exists vector with schema extensions;

-- 2. Repo chunks table for RAG embeddings
create table public.repo_chunks (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  repo_full_name text not null,           -- e.g. "octocat/hello-world"
  file_path text not null,                -- e.g. "src/utils/auth.ts"
  chunk_index integer not null,
  content text not null,
  token_count integer not null default 0,
  embedding extensions.vector(768),       -- Google text-embedding-004 dimensions
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- 3. Indexes
create index idx_repo_chunks_user_repo
  on public.repo_chunks(user_id, repo_full_name);

create index idx_repo_chunks_embedding
  on public.repo_chunks
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100);

-- 4. Row Level Security
alter table public.repo_chunks enable row level security;

create policy "Users can view their own chunks"
  on public.repo_chunks for select
  using (auth.uid() = user_id);

create policy "Users can insert their own chunks"
  on public.repo_chunks for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own chunks"
  on public.repo_chunks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own chunks"
  on public.repo_chunks for delete
  using (auth.uid() = user_id);

-- 5. Similarity search RPC function
create or replace function public.match_chunks(
  query_embedding extensions.vector(768),
  match_count int default 5,
  filter_repo text default null,
  filter_user_id uuid default null
)
returns table (
  id bigint,
  file_path text,
  content text,
  similarity float
)
language plpgsql
as $$
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
