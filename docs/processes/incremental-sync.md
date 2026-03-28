# Incremental Sync Pipeline

The incremental sync pipeline keeps a repository's knowledge base up-to-date by detecting and processing only the files that changed since the last sync.

## Trigger Methods

### 1. Manual Check (User-initiated)

```
User clicks "Check Now" → GET /api/repos/sync/check
  → Compares stored SHA vs GitHub HEAD SHA
  → Returns: { hasUpdates, newCommitCount, latestMessage }

User clicks "Sync Changes" → POST /api/repos/sync (SSE stream)
```

### 2. Automatic Webhook (Push-triggered)

```
Developer pushes to GitHub
  → GitHub sends POST to /api/webhooks/github
  → HMAC-SHA256 signature validated
  → Delivery ID deduplication checked
  → POST /api/repos/sync fired (fire-and-forget)
```

## Sync Pipeline Stages

```
POST /api/repos/sync (SSE stream)
  │
  ├─ 1. Compare SHAs (stored vs HEAD)
  ├─ 2. Fetch changed files (GitHub Compare API)
  │     └─ Fallback: iterate individual commits if >300 files
  ├─ 3. Categorize: added / modified / removed
  ├─ 4. Delete old chunks for changed + removed files
  ├─ 5. Fetch new content for added + modified files
  ├─ 6. Chunk + embed new content
  ├─ 7. Insert new chunks + file records
  ├─ 8. Store commit history in repo_commits
  └─ 9. Update last_synced_sha → SSE "done"
```

## Key Design Decisions

### SHA-based Change Detection

Instead of re-scanning the entire repo tree, we compare `repos.last_synced_sha` against the latest commit on the watched branch. This is O(1) — a single API call.

### Surgical Chunk Replacement

Only chunks belonging to changed files are deleted and re-created. Unchanged files keep their existing embeddings, making syncs proportional to the size of the changeset, not the repo.

### 300+ File Diff Handling

GitHub's Compare API returns a maximum of 300 files. When the diff exceeds this:

1. The system detects `files.length >= 300`
2. Falls back to iterating each individual commit in the range
3. Collects all changed files via per-commit file lists
4. Deduplicates using a Map (last-write-wins for status)

### Webhook Security

- **HMAC-SHA256:** Every webhook payload is verified against `GITHUB_WEBHOOK_SECRET`
- **Timing-safe comparison:** Uses `crypto.timingSafeEqual()` to prevent timing attacks
- **Delivery ID dedup:** Each webhook has a unique `x-github-delivery` header stored in `webhook_events` to prevent replay

### Fire-and-Forget Sync

The webhook handler responds to GitHub immediately (200 OK) and triggers the sync as a background fetch to `/api/repos/sync`. This prevents GitHub webhook timeout issues (10-second limit).

## Sync Settings

Managed via `GET/PATCH /api/repos/sync/settings`:

| Setting | Description | Default |
|---------|-------------|---------|
| `watched_branch` | Branch to monitor for changes | `main` |
| `auto_sync_enabled` | Enable/disable webhook monitoring | `false` |
| `understanding_tier` | Depth of analysis (1/2/3) | `2` |

Toggling `auto_sync_enabled`:
- **ON:** Registers a GitHub push webhook on the repo
- **OFF:** Deletes the webhook from GitHub

## SSE Progress Events

```jsonc
{ "status": "checking", "message": "Checking for changes..." }
{ "status": "fetching", "message": "Found 12 changed files", "filesChanged": 12 }
{ "status": "cleaning", "message": "Removing 12 old file chunks..." }
{ "status": "chunking", "filesProcessed": 5, "filesTotal": 12, "chunksCreated": 28 }
{ "status": "embedding", "chunksEmbedded": 28, "chunksTotal": 45 }
{ "status": "timeline", "message": "Updating development timeline..." }
{ "status": "done", "filesChanged": 12, "commitsTracked": 3, "newChunkCount": 1250 }
```

## Development Timeline

Every sync stores new commits in `repo_commits`, creating a visual history:

- Commit SHA, message, author, avatar, timestamp
- Files changed per commit (path, status, additions/deletions)
- Whether the commit triggered a sync (`sync_triggered` flag)
- Viewable on the **Timeline** tab with expandable file diffs
