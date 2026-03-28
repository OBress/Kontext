# Embedding System Architecture

Kontext uses vector embeddings to enable semantic code search and AI-powered repository understanding. This document covers the embedding model, its configuration, optimizations, and the evolution of the system.

## Current Configuration

| Property | Value |
|----------|-------|
| **Model** | `gemini-embedding-001` |
| **Provider** | Google AI Studio (BYOK) |
| **Dimensions** | 1536 (via Matryoshka Representation Learning) |
| **Index type** | HNSW (cosine similarity) |
| **Search function** | `match_chunks` RPC (pgvector) |

## Model Evolution

### v1: `text-embedding-004` (768 dimensions)

The original embedding model used when Kontext was first built.

- **Dimensions:** 768 (fixed)
- **Index:** IVFFlat with 100 lists
- **Status:** Deprecated by Google

### v2: `gemini-embedding-001` (1536 dimensions) ← Current

Upgraded to Google's latest production embedding model with significant improvements:

- **2x dimension increase:** 768 → 1536 for richer semantic representation
- **Task-type optimization:** Different embedding strategies for documents vs queries
- **Matryoshka Representation Learning (MRL):** Model natively supports flexible output dimensions (128, 256, 512, 768, 1536, 3072) — we chose 1536 as the highest tier that Supabase's pgvector can index
- **Better code understanding:** Trained on code corpora with improved semantic mapping

#### Why 1536 and not 3072?

Supabase's hosted pgvector has a **2000-dimension limit** on both IVFFlat and HNSW indexes. Without an index, every similarity search would be a full table scan — unacceptable for performance. 1536 is the optimal balance:

- Well within the 2000-dim index limit
- 2x quality improvement over the old 768-dim embeddings
- Standard dimension used by OpenAI's `text-embedding-3-large`, proving its effectiveness
- HNSW index provides sub-linear query time

## Task Types

`gemini-embedding-001` supports task-specific embeddings that optimize the vector space for different use cases:

| Task Type | Used When | File |
|-----------|-----------|------|
| `RETRIEVAL_DOCUMENT` | Embedding source code chunks for storage | `generateEmbeddings()` |
| `RETRIEVAL_QUERY` | Embedding a user's search/chat query | `generateQueryEmbedding()` |

Using matched task types (document ↔ query) improves retrieval accuracy by ~5-10% compared to using a single embedding type for both, per Google's benchmarks.

## Vector Search

### Database Schema

```sql
-- repo_chunks table
embedding vector(1536)  -- pgvector column

-- HNSW index for fast approximate nearest neighbor search
CREATE INDEX idx_repo_chunks_embedding
  ON repo_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

### HNSW Index Parameters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `m` | 16 | Max connections per node (higher = better recall, more memory) |
| `ef_construction` | 64 | Build-time search depth (higher = better index quality, slower build) |

These are balanced defaults. For very large repos (>100K chunks), consider increasing `m` to 32.

### Similarity Search RPC

```sql
-- match_chunks(query_embedding, match_count, filter_repo, filter_user_id)
-- Returns: id, file_path, content, similarity (0-1, higher = more similar)

SELECT * FROM match_chunks(
  '[0.1, 0.2, ...]'::vector,  -- 1536-dim query embedding
  10,                           -- top 10 results
  'owner/repo',                 -- filter to specific repo
  'user-uuid'                   -- filter to specific user
);
```

## Batch Processing

Embeddings are generated in controlled batches to manage API rate limits and memory:

```
Source code files
  → Chunk into ~500-token blocks (with 50-token overlap)
  → Batch 50 chunks at a time for embedding
  → Each batch calls batchEmbedContents() with up to 100 texts
  → SSE progress updates sent to client after each batch
```

### Why batch size 50?

- Google AI Studio's `batchEmbedContents` supports up to 100 texts per call
- We use 50 to keep memory pressure low and provide more granular progress updates
- For a 500-file repo generating ~2000 chunks, this means ~40 embedding API calls

## Cost Estimates by Tier

| Tier | Repo Size | Chunks | Embedding Cost | LLM Cost | Total |
|------|-----------|--------|----------------|----------|-------|
| 1 (Quick) | 100 files | ~200 | ~$0.001 | $0 | ~$0.001 |
| 2 (Standard) | 500 files | ~2000 | ~$0.02 | $0 | ~$0.02 |
| 3 (Deep) | 500 files | ~2000 | ~$0.02 | ~$0.15 | ~$0.17 |
| 2 (Standard) | 2000 files | ~8000 | ~$0.08 | $0 | ~$0.08 |
| 3 (Deep) | 2000 files | ~8000 | ~$0.08 | ~$0.60 | ~$0.68 |

*Costs based on Google AI Studio pricing. Users on Google AI Ultra with free credits pay $0.*

## Incremental Sync Efficiency

On incremental syncs, only changed files are re-embedded:

| Scenario | Files Re-embedded | Cost |
|----------|-------------------|------|
| 1 file changed | 1 file (~4 chunks) | ~$0.00005 |
| 10 files changed | 10 files (~40 chunks) | ~$0.0005 |
| 50 files changed | 50 files (~200 chunks) | ~$0.002 |

This makes continuous sync extremely cost-effective — even for active repos with multiple daily pushes.

## Future Considerations

- **`gemini-embedding-2-preview`:** Multimodal (images + text), currently in preview. Could enable embedding README images, architecture diagrams, etc. when it reaches GA.
- **Dimension scaling:** If Supabase upgrades pgvector to support >2000-dim indexes, we can bump to 3072 with a single constant change + migration.
- **Hybrid search:** Combining vector similarity with BM25 keyword search for better recall on exact identifier matches.
