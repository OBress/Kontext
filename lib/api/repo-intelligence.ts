
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildGitHubBlobUrl,
  detectCodeLanguage,
  stripChunkFileHeader,
} from "@/lib/code";
import {
  generateChatStream,
  generateMultimodalChatStream,
  generateQueryEmbedding,
  generateText,
} from "./embeddings";
import {
  buildTaskSystemInstruction,
  formatEvidencePack,
  PROMPT_GENERATION_CONFIGS,
} from "./prompt-contract";
import { toArchitectureBundle } from "@/types/architecture";

export type RepoAnswerMode = "grounded" | "partial" | "insufficient_evidence";

export interface RepoCitation {
  citation_id: string;
  index_version_id: string | null;
  commit_sha: string | null;
  file_path: string;
  line_start: number;
  line_end: number;
  language: string;
  snippet: string;
  retrieval_score: number;
  github_url: string | null;
}

export interface RepoTimelineCitation {
  sha: string;
  date: string;
  committed_at: string;
  ai_summary: string;
  message: string;
  author: string;
  author_avatar_url: string | null;
  push_group_id: string | null;
  similarity: number;
}

interface MatchChunk {
  id: number;
  file_path: string;
  content: string;
  similarity: number;
}

interface TimelineMatch {
  sha: string;
  message: string;
  ai_summary: string;
  author_name: string;
  author_avatar_url: string | null;
  committed_at: string;
  push_group_id: string | null;
  similarity: number;
}

interface ChunkMetadata {
  startLine?: number;
  endLine?: number;
}

interface ChunkDetails {
  id: number;
  file_path: string;
  content: string;
  metadata: ChunkMetadata | null;
}

interface RepoRow {
  last_synced_sha: string | null;
  last_indexed_at: string | null;
  watched_branch?: string | null;
  default_branch?: string | null;
  chunk_count?: number | null;
  auto_sync_enabled?: boolean | null;
  architecture_status?: string | null;
  architecture_analysis?: unknown;
}

interface RecentCommitRow {
  sha: string;
  message: string;
  ai_summary: string | null;
  author_name: string;
  author_avatar_url: string | null;
  committed_at: string;
  files_changed: unknown;
}

interface ActivityEventRow {
  event_type: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface CheckFindingRow {
  check_type: string;
  title: string;
  summary: string;
  severity: string;
  status: string;
  category: string | null;
  file_path: string | null;
  recommendation: string | null;
  confidence: number;
}

export interface RetrievedRepoContext {
  repo: RepoRow | null;
  repoLabel: string;
  citations: RepoCitation[];
  dedupedCitations: RepoCitation[];
  timelineCitations: RepoTimelineCitation[];
  answerMode: RepoAnswerMode;
  fileManifest: string;
  contextBlocks: string;
  timelineBlocks: string;
  recentCommitsBlock: string;
  architectureBlock: string;
  healthFindingsBlock: string;
  activityBlock: string;
  repoMetadataBlock: string;
  hasSupplementalContext: boolean;
}

function parseChunkMetadata(metadata: unknown): ChunkMetadata {
  if (!metadata || typeof metadata !== "object") return {};

  const record = metadata as Record<string, unknown>;
  return {
    startLine:
      typeof record.startLine === "number" ? record.startLine : undefined,
    endLine:
      typeof record.endLine === "number" ? record.endLine : undefined,
  };
}

export function classifyAnswerMode(
  citations: Array<{ retrieval_score: number }>,
  hasSupplementalContext = false
): RepoAnswerMode {
  if (citations.length === 0 && !hasSupplementalContext) return "insufficient_evidence";
  if (citations.length === 0 && hasSupplementalContext) return "partial";

  const strongestMatch = Math.max(
    ...citations.map((citation) => citation.retrieval_score)
  );

  return strongestMatch >= 0.78 ? "grounded" : "partial";
}

/* ------------------------------------------------------------------ */
/*  Query Intent Detection                                             */
/* ------------------------------------------------------------------ */

const RECENCY_PATTERNS =
  /\b(last|latest|most recent|newest|current|today|yesterday|this week|recent)\b.*\b(commit|push|change|update|merge|pr|pull request)\b|\b(commit|push|change|update|merge|pr|pull request)\b.*\b(last|latest|most recent|newest|current|today|yesterday|this week|recent)\b|\bwhat (was|were|is) (the |my )?(last|latest|most recent)\b/i;

const HEALTH_PATTERNS =
  /\b(security|vulnerability|vuln|finding|health|issue|bug|problem|risk|audit|check|scan|cve|critical|severity|unsafe|exploit)\b/i;

const ARCHITECTURE_PATTERNS =
  /\b(architecture|structure|component|layer|module|dependency|depend|design|overview|how .* (connect|work|interact|relate|organize|structured))\b/i;

const ACTIVITY_PATTERNS =
  /\b(pr|pull request|issue|release|workflow|deploy|ci|cd|merge|action|run|build|pipeline)\b/i;

const COMMIT_PATTERNS =
  /\b(commit|push|change|diff|what changed|who changed|when.*change|history|log|blame|authored|wrote)\b/i;

const CODE_LOOKUP_PATTERNS =
  /\b(file|files|function|functions|class|classes|component|components|hook|hooks|endpoint|endpoints|route|routes|api|service|services|schema|sql|migration|config|where is|which file|implementation|symbol|method|methods)\b/i;

function detectQueryIntent(query: string) {
  const q = query.toLowerCase();
  return {
    isRecencyQuery: RECENCY_PATTERNS.test(q),
    isHealthQuery: HEALTH_PATTERNS.test(q),
    isArchitectureQuery: ARCHITECTURE_PATTERNS.test(q),
    isActivityQuery: ACTIVITY_PATTERNS.test(q),
    isCommitQuery: COMMIT_PATTERNS.test(q),
    isCodeLookupQuery: CODE_LOOKUP_PATTERNS.test(q),
  };
}

export function buildFileManifest(
  filePaths: string[],
  matchedPaths: string[]
): string {
  if (filePaths.length <= 200) {
    return filePaths.join("\n");
  }

  const dirs = new Set<string>();
  for (const filePath of filePaths) {
    const parts = filePath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      dirs.add(parts.slice(0, index).join("/") + "/");
    }
  }

  return `Directory tree (${filePaths.length} files total):\n${[...dirs].sort().join("\n")}\n\nTop matched files:\n${[...new Set(matchedPaths)].sort().join("\n")}`;
}

export function dedupeCitationsByFile(citations: RepoCitation[]): RepoCitation[] {
  const fileMap = new Map<string, RepoCitation>();

  for (const citation of citations) {
    const existing = fileMap.get(citation.file_path);
    if (!existing || citation.retrieval_score > existing.retrieval_score) {
      fileMap.set(citation.file_path, {
        ...citation,
        snippet: "",
        line_start: 1,
        line_end: 1,
      });
    }
  }

  return [...fileMap.values()];
}

export async function retrieveRepoContext(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string | null;
  query: string;
  apiKey: string;
  includeTimeline?: boolean;
  matchCount?: number;
}): Promise<RetrievedRepoContext> {
  const {
    supabase,
    userId,
    repoFullName,
    query,
    apiKey,
    includeTimeline = true,
    matchCount = 25,
  } = params;

  const intent = detectQueryIntent(query);
  const embeddingTaskType =
    intent.isCodeLookupQuery || intent.isArchitectureQuery || intent.isHealthQuery
      ? "CODE_RETRIEVAL_QUERY"
      : "RETRIEVAL_QUERY";
  const effectiveMatchCount =
    intent.isCodeLookupQuery || intent.isArchitectureQuery
      ? Math.max(matchCount, 40)
      : intent.isCommitQuery || intent.isRecencyQuery
        ? Math.max(matchCount, 30)
        : matchCount;

  // ── Repo metadata (expanded) ─────────────────────────────────────────
  const repoQueryBuilder = supabase
    .from("repos")
    .select(
      "last_synced_sha, last_indexed_at, watched_branch, default_branch, chunk_count, auto_sync_enabled, architecture_status, architecture_analysis"
    );

  const { data: repo } = repoFullName
    ? await repoQueryBuilder
        .eq("user_id", userId)
        .eq("full_name", repoFullName)
        .single()
    : { data: null };

  // ── Embedding + hybrid search ────────────────────────────────────────
  const queryEmbedding = await generateQueryEmbedding(
    apiKey,
    query,
    embeddingTaskType
  );

  const { data: chunks, error } = await supabase.rpc("hybrid_match_chunks", {
    query_text: query,
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: effectiveMatchCount,
    filter_repo: repoFullName,
    filter_user_id: userId,
  });

  if (error) {
    console.error("hybrid_match_chunks error:", error);
  }

  const matches = (chunks || []) as MatchChunk[];
  const chunkIds = matches.map((chunk) => chunk.id);

  let chunkDetailsById = new Map<number, ChunkDetails>();
  if (chunkIds.length > 0) {
    const { data: chunkDetails } = await supabase
      .from("repo_chunks")
      .select("id, file_path, content, metadata")
      .in("id", chunkIds);

    chunkDetailsById = new Map(
      ((chunkDetails || []) as ChunkDetails[]).map((detail) => [
        detail.id,
        detail,
      ])
    );
  }

  const citations = matches.map((match, index) => {
    const details = chunkDetailsById.get(match.id);
    const metadata = parseChunkMetadata(details?.metadata);
    const snippet = stripChunkFileHeader(details?.content || match.content);
    const lineStart = metadata.startLine ?? 1;
    const lineEnd =
      metadata.endLine ??
      lineStart + Math.max(snippet.split("\n").length - 1, 0);
    const commitSha = repo?.last_synced_sha || null;

    return {
      citation_id: `${match.id}-${index}`,
      index_version_id: commitSha || repo?.last_indexed_at || null,
      commit_sha: commitSha,
      file_path: match.file_path,
      line_start: lineStart,
      line_end: lineEnd,
      language: detectCodeLanguage(match.file_path),
      snippet,
      retrieval_score: match.similarity,
      github_url: repoFullName
        ? buildGitHubBlobUrl(
            repoFullName,
            commitSha,
            match.file_path,
            lineStart,
            lineEnd
          )
        : null,
    };
  });

  const dedupedCitations = dedupeCitationsByFile(citations);

  const fileQuery = supabase
    .from("repo_files")
    .select("file_path")
    .eq("user_id", userId);

  const { data: repoFiles } = repoFullName
    ? await fileQuery.eq("repo_full_name", repoFullName).order("file_path")
    : await fileQuery.order("file_path");

  const allFilePaths = (repoFiles || []).map(
    (entry: { file_path: string }) => entry.file_path
  );
  const fileManifest = buildFileManifest(
    allFilePaths,
    matches.map((entry) => entry.file_path)
  );

  // ── Semantic timeline (lowered threshold) ─────────────────────────────
  let timelineCitations: RepoTimelineCitation[] = [];
  let timelineBlocks = "";

  if (includeTimeline) {
    const timelineMatchCount =
      intent.isRecencyQuery || intent.isCommitQuery ? 12 : 4;
    const { data: timelineChunks, error: timelineError } = await supabase.rpc(
      "match_timeline",
      {
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: timelineMatchCount,
        filter_repo: repoFullName,
        filter_user_id: userId,
      }
    );

    if (timelineError) {
      console.error("match_timeline error:", timelineError);
    }

    timelineCitations = ((timelineChunks || []) as TimelineMatch[])
      .filter((entry) => entry.similarity >= 0.35)
      .map((entry) => ({
        sha: entry.sha,
        date: new Date(entry.committed_at).toISOString().split("T")[0],
        committed_at: entry.committed_at,
        ai_summary: entry.ai_summary,
        message: entry.message,
        author: entry.author_name,
        author_avatar_url: entry.author_avatar_url,
        push_group_id: entry.push_group_id,
        similarity: entry.similarity,
      }));

    timelineBlocks = timelineCitations
      .map(
        (entry, index) =>
          `--- Timeline Entry ${index + 1}: ${entry.date} (commit ${entry.sha.slice(0, 7)} by ${entry.author}, relevance: ${(entry.similarity * 100).toFixed(1)}%) ---\n${entry.ai_summary}\nRaw commit message: ${entry.message.split("\n")[0]}\n`
      )
      .join("\n");
  }

  // ── Recency-aware recent commits ──────────────────────────────────────
  let recentCommitsBlock = "";
  if (
    repoFullName &&
    (intent.isRecencyQuery || intent.isCommitQuery)
  ) {
    try {
      const { data: recentCommits } = await supabase
        .from("repo_commits")
        .select(
          "sha, message, ai_summary, author_name, author_avatar_url, committed_at, files_changed"
        )
        .eq("user_id", userId)
        .eq("repo_full_name", repoFullName)
        .neq("author_name", "system")
        .order("committed_at", { ascending: false })
        .limit(intent.isCommitQuery || intent.isRecencyQuery ? 25 : 10);

      if (recentCommits && recentCommits.length > 0) {
        const rows = recentCommits as RecentCommitRow[];
        recentCommitsBlock = rows
          .map((commit, index) => {
            const date = new Date(commit.committed_at)
              .toISOString()
              .replace("T", " ")
              .slice(0, 19);
            const summary =
              commit.ai_summary || commit.message.split("\n")[0];
            const filesChanged = Array.isArray(commit.files_changed)
              ? (commit.files_changed as Array<{ path?: string }>)
                  .slice(0, 5)
                  .map((f) => f.path || "unknown")
                  .join(", ")
              : "";
            return `${index + 1}. [${commit.sha.slice(0, 7)}] ${date} by ${commit.author_name}\n   ${summary}${filesChanged ? `\n   Files: ${filesChanged}` : ""}`;
          })
          .join("\n");
      }
    } catch (err) {
      console.warn("[repo-intelligence] Recent commits fetch failed:", err);
    }
  }

  // ── Architecture context (heuristic-gated) ────────────────────────────
  let architectureBlock = "";
  if (intent.isArchitectureQuery && repo?.architecture_analysis) {
    try {
      const bundle = toArchitectureBundle(repo.architecture_analysis);
      if (bundle) {
        const components = (bundle.views?.system?.components || []).slice(
          0,
          15
        );
        const connections = (bundle.views?.system?.connections || []).slice(
          0,
          15
        );

        const componentList = components
          .map(
            (c) =>
              `- **${c.label}** (${c.type}): ${c.description}\n  Files: ${c.files.slice(0, 5).join(", ")}`
          )
          .join("\n");
        const connectionList = connections
          .map(
            (conn) => `- ${conn.source} → ${conn.target}: ${conn.description}`
          )
          .join("\n");

        architectureBlock = [
          `Architecture summary: ${bundle.summary}`,
          "",
          "Components:",
          componentList,
          "",
          "Connections / data flows:",
          connectionList,
        ].join("\n");
      }
    } catch (err) {
      console.warn("[repo-intelligence] Architecture parse failed:", err);
    }
  }

  // ── Health findings (heuristic-gated) ──────────────────────────────────
  let healthFindingsBlock = "";
  if (intent.isHealthQuery && repoFullName) {
    try {
      const { data: findings } = await supabase
        .from("repo_check_findings")
        .select(
          "check_type, title, summary, severity, status, category, file_path, recommendation, confidence"
        )
        .eq("user_id", userId)
        .eq("repo_full_name", repoFullName)
        .eq("status", "open")
        .order("severity", { ascending: true })
        .order("confidence", { ascending: false })
        .limit(15);

      if (findings && findings.length > 0) {
        const rows = findings as CheckFindingRow[];
        healthFindingsBlock = rows
          .map((f, i) => {
            const parts = [
              `${i + 1}. [${f.severity.toUpperCase()}] ${f.title} (${f.check_type})`,
              `   ${f.summary}`,
            ];
            if (f.file_path) parts.push(`   File: ${f.file_path}`);
            if (f.recommendation)
              parts.push(`   Recommendation: ${f.recommendation}`);
            return parts.join("\n");
          })
          .join("\n");
      }
    } catch (err) {
      console.warn("[repo-intelligence] Health findings fetch failed:", err);
    }
  }

  // ── Activity feed (heuristic-gated) ────────────────────────────────────
  let activityBlock = "";
  if (intent.isActivityQuery && repoFullName) {
    try {
      let activityQuery = supabase
        .from("activity_events")
        .select("event_type, title, description, metadata, created_at")
        .eq("user_id", userId)
        .eq("repo_full_name", repoFullName)
        .order("created_at", { ascending: false })
        .limit(15);

      // Filter by event type based on specific sub-patterns
      const q = query.toLowerCase();
      if (/\b(pr|pull request|merge)\b/.test(q)) {
        activityQuery = activityQuery.eq("event_type", "pull_request");
      } else if (/\bissue\b/.test(q)) {
        activityQuery = activityQuery.eq("event_type", "issue");
      } else if (/\b(release|tag)\b/.test(q)) {
        activityQuery = activityQuery.eq("event_type", "release");
      } else if (/\b(workflow|ci|cd|action|build|pipeline)\b/.test(q)) {
        activityQuery = activityQuery.eq("event_type", "workflow_run");
      }

      const { data: events } = await activityQuery;

      if (events && events.length > 0) {
        const rows = events as ActivityEventRow[];
        activityBlock = rows
          .map((e, i) => {
            const date = new Date(e.created_at)
              .toISOString()
              .replace("T", " ")
              .slice(0, 19);
            const meta = e.metadata || {};
            const author =
              (meta.author as string) ||
              (meta.actor as string) ||
              "";
            return `${i + 1}. [${e.event_type}] ${date}${author ? ` by ${author}` : ""}\n   ${e.title}${e.description ? `: ${e.description}` : ""}`;
          })
          .join("\n");
      }
    } catch (err) {
      console.warn("[repo-intelligence] Activity fetch failed:", err);
    }
  }

  // ── Repo metadata block ───────────────────────────────────────────────
  let repoMetadataBlock = "";
  if (repo && repoFullName) {
    const metaLines: string[] = [
      `Repository: ${repoFullName}`,
      `Default branch: ${repo.default_branch || "main"}`,
      `Watched branch: ${repo.watched_branch || repo.default_branch || "main"}`,
      `Last synced SHA: ${repo.last_synced_sha?.slice(0, 10) || "not synced"}`,
      `Last indexed: ${repo.last_indexed_at || "never"}`,
      `Indexed chunks: ${repo.chunk_count ?? "unknown"}`,
      `Auto-sync: ${repo.auto_sync_enabled ? "enabled" : "disabled"}`,
      `Architecture status: ${repo.architecture_status || "not analyzed"}`,
    ];
    repoMetadataBlock = metaLines.join("\n");
  }

  // ── Build code context ────────────────────────────────────────────────
  const contextBlocks = citations
    .map(
      (citation, index) =>
        `--- Citation ${index + 1}: ${citation.file_path}:${citation.line_start}-${citation.line_end} (retrieval score: ${(citation.retrieval_score * 100).toFixed(1)}%) ---\n${citation.snippet}\n`
    )
    .join("\n");

  const hasSupplementalContext =
    recentCommitsBlock.length > 0 ||
    timelineCitations.length > 0 ||
    architectureBlock.length > 0 ||
    healthFindingsBlock.length > 0 ||
    activityBlock.length > 0;

  return {
    repo,
    repoLabel: repoFullName || "all indexed repositories",
    citations,
    dedupedCitations,
    timelineCitations,
    answerMode: classifyAnswerMode(dedupedCitations, hasSupplementalContext),
    fileManifest,
    contextBlocks,
    timelineBlocks,
    recentCommitsBlock,
    architectureBlock,
    healthFindingsBlock,
    activityBlock,
    repoMetadataBlock,
    hasSupplementalContext,
  };
}

export function buildRepoAnswerSystemPrompt(): string {
  return buildTaskSystemInstruction({
    task: "grounded_explainer",
    role: "Kontext, a grounded repository explainer",
    mission:
      "Answer repository questions using only the supplied evidence pack. The pack may include code context, commit history, architecture analysis, health findings, activity events, and repository metadata.",
    outputStyle: [
      "Be brief and direct.",
      "Wrap repository file paths in backticks exactly as they appear in the evidence pack.",
      "Use Markdown bullets or compact tables when the question is list-shaped.",
      'If the evidence is not strong enough, say "Insufficient evidence" and suggest the next file or area to inspect.',
    ],
    taskRules: [
      "Use timeline and recent commit evidence when the question is about when, why, or what changed.",
      "Use architecture evidence when the question is about structure, components, dependencies, or data flows.",
      "Use health findings when the question is about security, quality, bugs, or audit results.",
      "Use activity feed when the question is about PRs, issues, releases, workflows, or CI/CD.",
      "When the user asks about the 'last' or 'most recent' commit, prefer the Recent commit history block ordered by date.",
      "For narrowly scoped recency questions, stay focused on the newest relevant commit unless the user explicitly asks for more history.",
      "When listing items such as files or endpoints, be thorough within the supplied evidence.",
      "Do not invent custom JSON payloads or Mermaid blocks in the answer text.",
      "Do not imply certainty beyond the retrieved context.",
    ],
  });
}

export function buildRepoAnswerPrompt(params: {
  repoFullName: string;
  fileManifest: string;
  contextBlocks: string;
  timelineBlocks?: string;
  recentCommitsBlock?: string;
  architectureBlock?: string;
  healthFindingsBlock?: string;
  activityBlock?: string;
  repoMetadataBlock?: string;
  conversationHistoryBlock?: string;
  extraInstructions?: string;
  question: string;
}): string {
  const {
    repoFullName,
    fileManifest,
    contextBlocks,
    timelineBlocks,
    recentCommitsBlock,
    architectureBlock,
    healthFindingsBlock,
    activityBlock,
    repoMetadataBlock,
    conversationHistoryBlock,
    extraInstructions,
    question,
  } = params;

  const supplementalExcerpts: Array<{
    title: string;
    source: string;
    reason: string;
    content: string;
  }> = [];

  if (conversationHistoryBlock) {
    supplementalExcerpts.push({
      title: "Recent chat history",
      source: repoFullName,
      reason:
        "Use this only to resolve follow-up references such as 'that commit' or 'that file'.",
      content: conversationHistoryBlock,
    });
  }

  if (recentCommitsBlock) {
    supplementalExcerpts.push({
      title: "Recent commit history (ordered by date, newest first)",
      source: repoFullName,
      reason:
        "Use this to answer questions about the latest, most recent, or last commits. This list is ordered chronologically with the newest commit first.",
      content: recentCommitsBlock,
    });
  }

  if (architectureBlock) {
    supplementalExcerpts.push({
      title: "Architecture analysis",
      source: repoFullName,
      reason:
        "Use this to answer questions about the repository structure, components, layers, modules, dependencies, and data flows.",
      content: architectureBlock,
    });
  }

  if (healthFindingsBlock) {
    supplementalExcerpts.push({
      title: "Repository health findings (open issues)",
      source: repoFullName,
      reason:
        "Use this to answer questions about security vulnerabilities, code quality issues, audit findings, and health check results.",
      content: healthFindingsBlock,
    });
  }

  if (activityBlock) {
    supplementalExcerpts.push({
      title: "Repository activity feed",
      source: repoFullName,
      reason:
        "Use this to answer questions about pull requests, issues, releases, workflow runs, and CI/CD activity.",
      content: activityBlock,
    });
  }

  const evidencePack = formatEvidencePack({
    summary:
      "Use the retrieved repository evidence to answer the question. Prefer exact citations over inference.",
    facts: [
      { label: "Repository", value: repoFullName, confidence: "exact" },
      { label: "Question", value: question, confidence: "exact" },
      ...(repoMetadataBlock
        ? [
            {
              label: "Repository metadata",
              value: repoMetadataBlock,
              confidence: "exact" as const,
            },
          ]
        : []),
    ],
    excerpts: [
      {
        title: "Repository file manifest",
        source: repoFullName,
        reason:
          "Use this to reason about likely locations when the retrieved snippets are partial.",
        content: fileManifest,
      },
      {
        title: "Retrieved code context",
        source: repoFullName,
        reason: "Primary evidence for the answer.",
        content:
          contextBlocks || "No retrieved repository code context was found.",
      },
      ...(timelineBlocks
        ? [
            {
              title: "Development timeline context (semantic matches)",
              source: repoFullName,
              reason:
                "Semantically matched commit summaries. Use when the question depends on when or why something changed.",
              content: timelineBlocks,
            },
          ]
        : []),
      ...supplementalExcerpts,
    ],
    coverageGaps: [
      contextBlocks
        ? ""
        : "No retrieved code snippet matched strongly. Be explicit about limited evidence.",
    ].filter(Boolean),
  });

  return [
    "Answer the repository question using the supplied evidence pack.",
    extraInstructions ? `Additional instruction: ${extraInstructions}` : "",
    "",
    evidencePack,
    "",
    "Answer requirements:",
    "- Start with the direct answer.",
    "- Keep the answer grounded in the evidence pack.",
    "- Mention relevant file paths in backticks when they support the answer.",
    "- Use flat bullets or a compact Markdown table when the request is list-shaped or comparative.",
    "- For recency questions (last/latest/newest), use the Recent commit history which is ordered by date.",
    "- Stay scoped to the newest relevant commit unless the user asks for broader history.",
    "- Include commit SHAs, dates, and authors when answering commit-related questions.",
    "- If evidence is partial, say so briefly instead of guessing.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function answerRepoQuestion(params: {
  apiKey: string;
  repoFullName: string;
  question: string;
  fileManifest: string;
  contextBlocks: string;
  timelineBlocks?: string;
  recentCommitsBlock?: string;
  architectureBlock?: string;
  healthFindingsBlock?: string;
  activityBlock?: string;
  repoMetadataBlock?: string;
  conversationHistoryBlock?: string;
  extraInstructions?: string;
}): Promise<string> {
  return generateText(
    params.apiKey,
    buildRepoAnswerPrompt(params),
    {
      systemInstruction: buildRepoAnswerSystemPrompt(),
      generationConfig: PROMPT_GENERATION_CONFIGS.groundedAnswer,
    }
  );
}

export async function streamRepoAnswer(params: {
  apiKey: string;
  repoFullName: string;
  question: string;
  fileManifest: string;
  contextBlocks: string;
  timelineBlocks?: string;
  recentCommitsBlock?: string;
  architectureBlock?: string;
  healthFindingsBlock?: string;
  activityBlock?: string;
  repoMetadataBlock?: string;
  conversationHistoryBlock?: string;
  extraInstructions?: string;
  attachedFileBlocks?: string;
  imageParts?: Array<{ mimeType: string; data: string }>;
}): Promise<ReadableStream<Uint8Array>> {
  const promptText = buildRepoAnswerPrompt(params);
  const fullPrompt = params.attachedFileBlocks
    ? `${promptText}\n\n--- Explicitly attached file context (user-selected via @-mention) ---\n${params.attachedFileBlocks}`
    : promptText;

  const streamOptions = {
    systemInstruction: buildRepoAnswerSystemPrompt(),
    generationConfig: PROMPT_GENERATION_CONFIGS.groundedAnswer,
  };

  if (params.imageParts && params.imageParts.length > 0) {
    const parts = [
      { text: fullPrompt },
      ...params.imageParts.map((img) => ({
        inlineData: { mimeType: img.mimeType, data: img.data },
      })),
    ];
    return generateMultimodalChatStream(params.apiKey, parts, streamOptions);
  }

  return generateChatStream(params.apiKey, fullPrompt, streamOptions);
}
