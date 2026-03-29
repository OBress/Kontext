# Kontext Ingestion And Update Audit

Date: 2026-03-28

## Scope

This audit reviewed the full repository ingestion path, incremental sync path, webhook handling, retrieval layer, and the product surfaces those systems power.

Primary repo areas reviewed:

- `app/api/repos/ingest/route.ts`
- `app/api/repos/sync/route.ts`
- `app/api/webhooks/github/route.ts`
- `lib/api/github.ts`
- `lib/api/embeddings.ts`
- `lib/api/timeline-ai.ts`
- `lib/api/repo-intelligence.ts`
- `lib/api/architecture-refresh.ts`
- `supabase/schema.sql`
- `app/components/dashboard/IngestionConfigPanel.tsx`
- `app/components/repo/SyncPanel.tsx`
- `app/repo/[owner]/[name]/chat/page.tsx`

External research was used to compare the implementation against current GitHub, Gemini, Supabase, pgvector, Next.js, and hackathon judging guidance.

## Executive Summary

Kontext already has more product depth than a typical hackathon repo analyzer.

The strongest part of the product is not a single feature. It is the chain:

1. Add repo
2. Ingest code
3. Keep it fresh with sync and webhooks
4. Turn the indexed state into chat, architecture, timeline, and activity views

That is a strong hackathon story.

The main issue is time-to-wow. The current system is architecturally thoughtful, but several slow or partially finished parts make the first-use experience heavier than it should be:

- full ingest and sync fetch files serially
- deep history backfill is too aggressive by default
- commit summarization is serial
- the "Quick Scan" tier is not actually implemented
- webhook dedup is documented but not actually enforced
- some of the best provenance data is generated but not fully surfaced in the chat UI

If those are tightened, Kontext stops feeling like "a promising internal tool" and starts feeling like "the repo intelligence product judges remember after the demo."

## Product Scorecard

| Area | Score | Notes |
| --- | --- | --- |
| Product concept | 8.5/10 | Strong, clear, useful, and demoable |
| Data ingestion design | 8/10 | Good shape, atomic DB promotion, strong SSE feedback |
| Freshness / updates | 8/10 | Manual sync, webhook sync, timeline refresh, architecture refresh |
| Performance today | 5.5/10 | Main bottlenecks are self-inflicted and fixable |
| Reliability today | 6/10 | Good intent, but background work and webhook dedup are not durable enough |
| Hackathon readiness | 7/10 | Above average now, but needs a tighter "wow in 60 seconds" path |
| Demo clarity | 6.5/10 | Strong raw material, but evidence and freshness value are not fully surfaced |

## What Is Already Good

### 1. The pipeline is product-shaped, not just infra-shaped

The ingest system is not building vectors in isolation. It directly powers:

- grounded repo chat
- architecture visualization
- AI architecture summaries
- development timeline
- activity feed
- sync status and freshness UX

That gives Kontext a real product loop instead of "upload files and ask questions."

### 2. The storage promotion strategy is smart

Both full ingest and incremental sync use DB-side replacement functions:

- `replace_repo_index(...)`
- `replace_repo_paths(...)`

That means the live index is promoted after embeddings are ready, which is the right reliability pattern for a demo and a production path.

### 3. Incremental sync is directionally excellent

The product already avoids full re-indexes after every push:

- compare current HEAD vs stored SHA
- isolate changed files
- delete only changed paths
- re-chunk and re-embed only those files
- keep commit history aligned with sync activity

That is one of the highest-leverage architectural choices in the whole repo.

### 4. Retrieval quality is better than a basic RAG app

The stack is already stronger than "vector search only":

- hybrid retrieval (`tsvector` + vector search + RRF)
- commit timeline embeddings
- file metadata and imports
- code-aware chunk boundaries
- file inspector with line-aware citations

This is a good base for a differentiated repository intelligence experience.

## High-Confidence Findings

### Finding 1: Ingest and sync are slower than they need to be because file fetch and deep analysis are serial

Evidence:

- Full ingest loops through every tree entry one at a time and awaits `fetchFileContent(...)` in sequence: `app/api/repos/ingest/route.ts:147-202`
- Incremental sync does the same for changed files: `app/api/repos/sync/route.ts:252-305`
- Tier 3 file summaries are also generated inline during those loops: `app/api/repos/ingest/route.ts:174-178`, `app/api/repos/sync/route.ts:277-280`

Impact:

- Long cold-start indexing times
- Slower sync after pushes
- Higher perceived fragility during live demos
- Time-to-first-value is worse than the architecture deserves

Why this matters externally:

- GitHub's contents endpoint is fine for single files, but GitHub explicitly recommends the Git Trees API for recursive listing and provides repository archive endpoints for bulk retrieval patterns: [GitHub Contents API](https://docs.github.com/en/rest/repos/contents), [GitHub Git Trees API](https://docs.github.com/en/rest/git/trees)

Audit judgment:

- This is the single biggest performance bottleneck in the current product.

### Finding 2: The code and the docs disagree about performance behavior

Evidence:

- The docs describe file fetch as "parallelized" and describe larger embedding batches
- Actual code uses strictly serial fetch loops
- Actual embedding config is `GEMINI_EMBEDDING_BATCH_SIZE = 20` with `GEMINI_EMBEDDING_BATCH_DELAY_MS = 750`: `lib/api/gemini.ts:4-8`
- Embeddings are generated batch-by-batch with a delay between batches: `lib/api/embeddings.ts:36-74`

Impact:

- Engineering assumptions drift away from reality
- Demo expectations become unreliable
- Performance tuning becomes harder because the docs describe a different system

Audit judgment:

- This is not just a documentation issue. It reduces trust in the pipeline story.

### Finding 3: "Quick Scan" is not implemented yet, even though it is sold as a tier

Evidence:

- The only behavior gate on understanding tier in ingest and sync is `understandingTier === 3` for file summaries: `app/api/repos/ingest/route.ts:174-178`, `app/api/repos/sync/route.ts:277-280`
- The sync settings UI literally labels tier 1 as future work: `app/components/repo/SyncPanel.tsx:270-295`

Impact:

- Cost and latency expectations are misleading
- The product lacks a true low-friction demo mode
- Large-repo onboarding is weaker than it should be

Audit judgment:

- This is the biggest feature gap relative to the product's own positioning.

### Finding 4: Incremental sync can index large text files that full ingest would skip

Evidence:

- Full ingest filters files above `MAX_FILE_SIZE = 100_000` bytes via `fetchRepoTree(...)`: `lib/api/github.ts:21`, `lib/api/github.ts:161-165`
- Incremental sync only uses `shouldIndexFile(...)`, which does not enforce the size cap: `lib/api/github.ts:218-223`, `app/api/repos/sync/route.ts:219-222`

Impact:

- Index consistency drift between full ingest and later syncs
- Surprise latency spikes on pushes involving large text files
- Demo behavior can look random across repos

Audit judgment:

- This is a real correctness and performance bug.

### Finding 5: Webhook dedup is documented, but not actually implemented

Evidence:

- The webhook handler validates the signature and reads `x-github-delivery`, but it never inserts or checks a delivery record before processing: `app/api/webhooks/github/route.ts:35-205`
- `markProcessed(...)` only updates `webhook_events` rows if they already exist: `app/api/webhooks/github/route.ts:26-33`
- Repo-wide search shows no insert into `webhook_events`

Impact:

- Replay or duplicate delivery handling is unreliable
- Push-triggered syncs may run twice
- Timeline rows and activity rows may be duplicated under load or redelivery

Why this matters externally:

- GitHub's webhook guidance explicitly recommends responding quickly, processing asynchronously, and using `X-GitHub-Delivery` to ensure uniqueness per event: [GitHub webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)

Audit judgment:

- This is the most important reliability gap in the update path.

### Finding 6: Background work is not durable enough for the amount of post-response work the app is doing

Evidence:

- Webhook sync is triggered by a fire-and-forget internal fetch: `app/api/webhooks/github/route.ts:176-199`
- Architecture refresh is kicked off with `void refreshArchitectureBundle(...)`: `lib/api/architecture-refresh.ts:511-536`
- Activity backfill is also fire-and-forget from repo add

Impact:

- Jobs may not complete consistently depending on runtime behavior
- The app can look flaky even when core logic is correct
- Demo timing becomes nondeterministic

Why this matters externally:

- Next.js now provides `after(...)` for post-response work and documents `waitUntil(...)` semantics for serverless runtimes: [Next.js `after`](https://nextjs.org/docs/app/api-reference/functions/after)

Audit judgment:

- Good enough for experimentation, not strong enough for a winner-level demo that depends on dependable freshness.

### Finding 7: Timeline backfill is too expensive by default for first-run onboarding

Evidence:

- Default add-repo config sets `timeline_commit_depth: 1000`: `app/components/dashboard/IngestionConfigPanel.tsx:22-28`
- The UI labels 1000 as "All": `app/components/dashboard/IngestionConfigPanel.tsx:45-50`
- Commit summarization is sequential: `lib/api/timeline-ai.ts:58-89`
- Summary writes are sequential too: `lib/api/timeline-ai.ts:139-148`

Impact:

- First index can do far more work than necessary
- The first user impression is waiting instead of insight
- A strong feature becomes a cold-start tax

Why this matters externally:

- GitHub compare responses are also constrained by pagination rules, 250 commits without paging and only up to 300 changed files shown in the first page of comparisons: [GitHub Compare Two Commits](https://docs.github.com/en/rest/commits/commits#compare-two-commits)

Audit judgment:

- Great feature, wrong default for hackathon use.

### Finding 8: The retrieval layer is strong, but the UI is not fully cashing in on it

Evidence:

- Chat API emits citations, timeline citations, and answer mode before streaming the answer: `app/api/chat/route.ts:45-74`
- The chat page stores citation context and auto-selects the first citation: `app/repo/[owner]/[name]/chat/page.tsx` around `setLastAssistantContext(...)` and `selectCitation(data.citations[0])`
- Lint currently flags unused citation UI components and unused citation props in the chat page

Impact:

- The product generates trust-building evidence, but users do not get the full payoff
- The strongest "judges can see why this answer is credible" moment is muted

Audit judgment:

- This is a UX leverage issue more than a backend issue, but it directly reduces the visible value of the ingestion system.

## What The Current Features Contribute To The Product

### Chat

Contribution:

- Highest utility surface
- Converts indexing into immediate developer value
- Strongest proof that the pipeline matters

What it needs:

- better evidence display
- explicit freshness cues
- faster first indexing

### Architecture view

Contribution:

- Best visual demo asset
- Gives judges something memorable and non-textual
- Makes the product feel bigger than "repo Q&A"

What it needs:

- more dependable refresh timing
- clearer diff/freshness state after pushes

### Timeline

Contribution:

- Distinguishes Kontext from generic codebase chat products
- Turns sync into narrative memory
- Gives natural prompts for "what changed" and "why did this evolve"

What it needs:

- lighter onboarding defaults
- background batching
- stronger linkage from timeline to architecture/chat

### Sync and webhook layer

Contribution:

- Adds credibility
- Makes the repo feel alive instead of static
- Supports a strong demo story: "push code, watch Kontext update"

What it needs:

- true dedup
- durable async handling
- a visible "freshness" payoff in the UI

## Research-Based Product Guidance

### What the current technical direction gets right

- Hybrid search is the right choice for code repositories. Supabase specifically calls out code repositories and error-message lookup as strong keyword-search use cases, while hybrid search combines exact and contextual relevance: [Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search)
- The 1536-dimension choice is sensible. Gemini recommends 768, 1536, or 3072 output sizes, and pgvector HNSW indexes support `vector` up to 2,000 dimensions: [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings), [pgvector README](https://github.com/pgvector/pgvector)
- The webhook-first freshness model is right. GitHub wants fast 2XX responses and async handling: [GitHub webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)

### What current best practices suggest adding next

1. Durable async execution for post-response work
2. More exact code retrieval via symbols, definitions, and references
3. Better batching economics for non-interactive work
4. Stronger demo storytelling around freshness, impact, and proof

GitHub's own code navigation guidance is a good model here. GitHub uses `tree-sitter`-based code navigation, symbol search, definitions, and references across repositories: [Navigating code on GitHub](https://docs.github.com/en/repositories/working-with-files/using-files/navigating-code-on-github)

Gemini's docs also now call out Batch API support for much higher throughput at half the default embedding price, which is a strong fit for initial ingest backfills and commit summarization jobs that do not need immediate response latency: [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings)

## What Will Make This Win A Hackathon

Hackathon judging usually rewards three things over and over:

- idea quality / originality
- implementation quality
- impact

Devpost's own judging guidance highlights those exact dimensions, and judge interviews emphasize storytelling, creativity, polished demos, and clearly satisfying the prompt: [Devpost judging guidance](https://help.devpost.com/article/64-judging-public-voting), [Devpost judge advice](https://info.devpost.com/blog/hackathon-judging-tips)

So the winning strategy for Kontext is:

1. Keep the technical core
2. Make first value dramatically faster
3. Turn freshness into a visible magic trick
4. Tell a sharper story than "chat with your repo"

## Best Feature Additions To Win

These are the feature additions I would emphasize most strongly.

### Tier 1: Highest-impact additions

#### 1. Repo Launch Brief

On first ingest, generate a polished "launch brief" with:

- what this repo does
- key components
- likely tech stack
- main API surfaces
- likely onboarding path
- biggest current risks

Why it wins:

- immediate wow factor
- easy to demo
- judges instantly understand the value

#### 2. Push-to-Insight Mode

After each sync, automatically show:

- what changed
- affected components
- likely user-facing impact
- suggested regression test areas
- 3 follow-up questions

Why it wins:

- makes freshness visible
- feels alive and intelligent
- turns a backend sync into a memorable product moment

#### 3. Architecture Diff

Do not just show the architecture.
Show what moved between two SHAs:

- new components
- removed components
- changed edges
- hotspots touched by recent commits

Why it wins:

- very visual
- unique vs generic code chat tools
- strong live-demo material

#### 4. Ask-From-Timeline

Let users click a commit cluster or timeline item and ask:

- "why did this change?"
- "what files were affected?"
- "did this modify auth / billing / sync?"

Why it wins:

- connects memory + reasoning
- makes the timeline more than a history log

### Tier 2: Strong differentiators

#### 5. Symbol-Aware Code Navigation

Add symbol extraction for:

- functions
- classes
- routes
- exports
- references

Then support:

- "where is this defined?"
- "who calls this?"
- "what changed this API?"

Why it wins:

- makes answers sharper
- improves trust
- aligns with how top developer tools behave

#### 6. Regression Radar

When code changes, auto-highlight likely break zones:

- auth
- API contracts
- config
- database access
- imports crossing layers

Why it wins:

- turns Kontext from explainer into engineering assistant
- judges love features that feel useful immediately

#### 7. Onboarding Mode

Create a "new engineer" view:

- start here
- read these files first
- key concepts
- top architectural flows
- glossary of repo-specific terms

Why it wins:

- easy to understand business value
- broadens the product beyond AI chat

### Tier 3: Showmanship features

#### 8. Live Demo Repo Simulator

Bundle one curated demo repo and one guided flow:

1. add repo
2. quick scan completes
3. ask a question
4. inspect architecture
5. trigger a fake or real commit
6. watch Kontext explain the change

Why it wins:

- removes demo risk
- makes the story crisp

#### 9. Shareable Executive Summary

Generate a clean readout for non-engineers:

- what this project is
- what changed this week
- delivery velocity
- risky areas
- product impact summary

Why it wins:

- expands the audience
- makes the project feel startup-ready

#### 10. Team Prompt Packs

Auto-generate prompts for:

- onboarding
- bug triage
- release review
- architecture review
- PR review

Why it wins:

- low implementation cost
- high perceived usefulness

## If You Only Build Three New Features

Build these:

1. Repo Launch Brief
2. Push-to-Insight Mode
3. Architecture Diff

That trio gives you:

- fast first value
- strong visual demo moments
- a much more original pitch than "chat with your repo"

## Strongest Pitch Reframe

The best version of the product is not:

"AI that chats with your codebase."

It is:

"An AI system that turns a GitHub repo into a living engineering memory: it understands the code, tracks every important change, explains architecture, and tells teams what changed and why it matters."

## Recommended Roadmap

### Priority 0: Must do before a serious demo

#### A. Implement a real fast path

Ship an actual tier 1:

- index only README, docs, config, routes, pages, package manifests, and top N important files
- skip full-code embeddings
- produce architecture + repo brief in under 60 seconds

Why:

- judges care about the first minute
- this removes the cold-start drag without losing the product story

#### B. Parallelize fetch and preprocess work

Change full ingest and sync to bounded concurrency:

- 8-16 concurrent file fetches
- 2-4 concurrent file summaries at most
- keep SSE updates aggregated

Better still:

- use tree/blob metadata more effectively
- consider raw archive download for cold ingest

#### C. Make webhook processing truly idempotent

Add:

- insert-on-receive into `webhook_events`
- reject duplicate `delivery_id`
- mark status transitions explicitly
- track sync job state per delivery

#### D. Reduce default timeline backfill to 50

Then:

- background the rest
- summarize later
- never block initial "repo is ready" on deep history

### Priority 1: Highest-leverage hackathon differentiators

#### A. Push-to-insight demo flow

After every sync:

- generate "what changed" summary
- show architecture diff
- surface new affected components
- suggest 3 follow-up questions automatically

Pitch:

"Push code, and Kontext immediately explains what changed, what broke, and what part of the architecture moved."

#### B. Symbol-aware search and navigation

Add tree-sitter extraction for:

- symbols
- definitions
- references
- exported API surfaces

Use it in:

- retrieval reranking
- graph enrichment
- "where is this defined?" flows

This is one of the most credible upgrades because it aligns with how strong code navigation products work.

#### C. Better evidence UX in chat

Surface:

- citation chips
- timeline chips
- freshness badge
- "indexed at SHA" badge
- "answer confidence" with clearer semantics

The backend already produces much of this value.

#### D. One-click repo brief

Generate a shareable artifact:

- what this repo does
- key systems
- recent changes
- hotspots
- onboarding questions

That is extremely demoable and sponsor-friendly.

### Priority 2: Cost and scale improvements

#### A. Use Gemini Batch API for non-interactive work

Use batch for:

- initial cold embeddings
- historical timeline summaries
- long-tail architecture refresh

Keep synchronous API calls only for user-blocking operations.

#### B. Add content-hash skip logic on sync

You already store `content_hash`.

Use it to avoid re-embedding when:

- file metadata changed but content did not
- compare payload is noisy

#### C. Improve code-aware ranking

Today the full text side is general English `tsvector`.

Add search features for:

- file path
- symbol name
- import/export names
- route names
- error strings

That will materially improve exact-match code retrieval.

## Suggested 72-Hour Hackathon Plan

### Day 1

- Implement real Quick Scan tier
- Parallelize file fetches
- Reduce timeline default to 50
- Add true webhook GUID dedup

### Day 2

- Build push-to-insight sync summary
- Surface citation chips and freshness in chat
- Add architecture stale/fresh diff banner

### Day 3

- Add symbol extraction for top languages used in demo repos
- Create one-click repo brief
- Polish the demo flow and script

## Recommended Demo Narrative

The strongest version of this product pitch is:

"Kontext turns a GitHub repo into a living, searchable system memory. It does not just answer questions about the codebase. It stays current as the repo changes, explains the architecture, narrates the timeline, and shows exactly where its answers came from."

Then show:

1. Add repo
2. Quick Scan completes fast
3. Ask a question in chat with citations
4. Open architecture view
5. Push a code change
6. Watch sync complete
7. Show "what changed" summary and updated architecture/timeline

That is the winner path.

## Verification Notes

Ran locally on 2026-03-28:

- `.\node_modules\.bin\tsc.cmd --noEmit` -> passed
- `.\node_modules\.bin\next.cmd build` -> passed

Lint status:

- `.\node_modules\.bin\eslint.cmd .` -> failed
- One React hook performance lint error exists in `app/mcp/page.tsx`
- Several unused citation-related warnings exist in `app/repo/[owner]/[name]/chat/page.tsx`

These lint issues do not block the audit conclusions, but they do reinforce the observation that some UI evidence plumbing is partially implemented.

## Final Call

Kontext is already good enough to interest judges.

It is not yet optimized to win them.

The winning move is not a total rewrite. It is to tighten the first-run experience, make freshness feel magical, and expose the proof system the backend already knows how to generate.

If the team only does five things, do these:

1. Real Quick Scan tier
2. Parallel file fetch and bounded summarization concurrency
3. True webhook delivery dedup
4. Smaller default history backfill
5. Visible citations + freshness + "what changed" after sync

That combination gives Kontext a better shot at being remembered as a product, not just a promising prototype.

## Sources

- GitHub REST contents API: https://docs.github.com/en/rest/repos/contents
- GitHub REST git trees API: https://docs.github.com/en/rest/git/trees
- GitHub REST compare two commits: https://docs.github.com/en/rest/commits/commits#compare-two-commits
- GitHub webhook best practices: https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks
- GitHub code navigation: https://docs.github.com/en/repositories/working-with-files/using-files/navigating-code-on-github
- Google Gemini embeddings: https://ai.google.dev/gemini-api/docs/embeddings
- Supabase hybrid search: https://supabase.com/docs/guides/ai/hybrid-search
- Supabase pgvector docs: https://supabase.com/docs/guides/database/extensions/pgvector
- pgvector README: https://github.com/pgvector/pgvector
- Next.js `after`: https://nextjs.org/docs/app/api-reference/functions/after
- Devpost judging criteria: https://help.devpost.com/article/64-judging-public-voting
- Devpost judge advice: https://info.devpost.com/blog/hackathon-judging-tips
