# Full Ingestion Pipeline

The ingestion pipeline converts a GitHub repository into a searchable, AI-queryable knowledge base by fetching files, chunking content, generating embeddings, and storing everything in Supabase.

## Pipeline Flow

```
User clicks "Index" → POST /api/repos/ingest (SSE stream)
  │
  ├─ 1. Fetch repository tree (GitHub API)
  ├─ 2. Fetch file contents (filtered, parallelized)
  ├─ 3. Chunk files into semantic blocks
  ├─ 4. Generate vector embeddings (gemini-embedding-001)
  ├─ 5. Delete old chunks (full replace)
  ├─ 6. Insert new chunks + embeddings
  ├─ 7. Upsert file records (graph data)
  ├─ 8. Store HEAD SHA (sync baseline)
  ├─ 9. Backfill commit history
  └─ 10. Update repo status → SSE "done"
```

## Stage Details

### 1. Repository Tree Fetch

**File:** `lib/api/github.ts` → `fetchRepoTree()`

- Uses GitHub's recursive tree API: `GET /repos/{owner}/{name}/git/trees/{branch}?recursive=1`
- Falls back from `main` → `master` on 404
- Filters applied:
  - **Skip directories:** `node_modules`, `.git`, `dist`, `build`, `.next`, `__pycache__`, `vendor`, etc.
  - **Skip binary files:** images, fonts, videos, archives, executables, lockfiles
  - **Size limit:** Files > 100KB are skipped

### 2. File Content Fetch

**File:** `lib/api/github.ts` → `fetchFileContent()`

- Fetches via `GET /repos/{owner}/{name}/contents/{path}`
- Decodes base64-encoded content from GitHub API
- Returns `null` for inaccessible/empty files (non-fatal)

### 3. Chunking

**File:** `lib/api/chunker.ts` → `chunkFile()`

Each file is split into overlapping semantic chunks optimized for embedding quality:

- **Target chunk size:** ~500 tokens
- **Overlap:** 50 tokens between consecutive chunks
- **Metadata per chunk:**
  - `file_path`, `chunk_index`, `token_count`
  - Language detection from file extension
  - Import/export extraction (for dependency graph)

### 4. Embedding Generation

**File:** `lib/api/embeddings.ts` → `generateEmbeddings()`

- **Model:** `gemini-embedding-001` (upgraded from deprecated `text-embedding-004`)
- **Dimensions:** 1536 (via Matryoshka Representation Learning)
- **Task type:** `RETRIEVAL_DOCUMENT` for indexing, `RETRIEVAL_QUERY` for search
- **Batch size:** 100 texts per API call (Google AI limit)
- **Processing batch:** 50 chunks at a time with SSE progress updates

### 5–7. Storage

All database operations use the Supabase admin client (service role) to bypass RLS:

| Table | Purpose |
|-------|---------|
| `repo_chunks` | Chunked content + 1536-dim vector embeddings |
| `repo_files` | File metadata, line counts, detected imports |
| `repos` | Repository status flags (`indexed`, `indexing`, `chunk_count`) |
| `ingestion_jobs` | Job tracking with status progression |

### 8. SHA Baseline

After ingestion completes, the HEAD commit SHA is stored in `repos.last_synced_sha`. This becomes the baseline for future incremental syncs — the system only needs to process files that changed since this SHA.

### 9. Commit Backfill

The current HEAD commit is stored in `repo_commits` as the initial baseline entry, enabling the development timeline to show when ingestion occurred.

## SSE Progress Events

The endpoint streams Server-Sent Events to the client for real-time progress:

```jsonc
{ "status": "fetching", "message": "Fetching repository tree..." }
{ "status": "chunking", "filesTotal": 142, "filesProcessed": 50, "chunksCreated": 230 }
{ "status": "embedding", "chunksEmbedded": 100, "chunksTotal": 450 }
{ "status": "finalizing", "message": "Setting up sync tracking..." }
{ "status": "timeline", "message": "Backfilling commit history..." }
{ "status": "done", "filesTotal": 142, "filesProcessed": 142, "chunksCreated": 450 }
```

## Understanding Tiers

The ingestion depth is controlled by `repos.understanding_tier`:

| Tier | Name | What it does | Cost |
|------|------|--------------|------|
| 1 | Quick Scan | Regex-based analysis + key file embedding only | ~Free |
| 2 | Standard | Full codebase embedding with 1536-dim vectors | $0.02–0.10 |
| 3 | Deep Dive | Full embedding + LLM-generated file summaries per file | $0.10–0.50 |

Tier 3 calls `generateFileSummary()` which uses `gemini-2.0-flash` to produce a 2–3 sentence summary stored in chunk metadata, enriching the context available during RAG retrieval.

## Error Handling

- If any stage fails, the SSE stream emits `{ "status": "error", "message": "..." }`
- The `ingestion_jobs` row is updated to `status: "error"` with the error message
- The `repos.indexing` flag is reset to `false` so the user can retry
- Individual file fetch failures are non-fatal — the pipeline skips and continues
