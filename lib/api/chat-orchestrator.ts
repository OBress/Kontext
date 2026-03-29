import { Type } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildConversationHistoryBlock,
  findLastResolvedCommit,
} from "@/lib/chat-messages";
import type {
  ChatFreshnessMeta,
  ChatSourceMode,
  PersistedChatMessage,
} from "@/types/chat";
import {
  fetchCommitDetails,
  fetchFileContent,
  fetchLatestCommit,
  type GitHubChangedFile,
} from "@/lib/api/github";
import { generateStructuredJson } from "@/lib/api/embeddings";
import {
  buildTaskSystemInstruction,
  PROMPT_GENERATION_CONFIGS,
  truncatePromptText,
} from "@/lib/api/prompt-contract";
import type { RepoCitation } from "@/lib/api/repo-intelligence";
import {
  buildGitHubBlobUrl,
  detectCodeLanguage,
  stripChunkFileHeader,
} from "@/lib/code";

interface RepoRow {
  last_synced_sha: string | null;
  last_indexed_at: string | null;
  watched_branch?: string | null;
  default_branch?: string | null;
}

interface CommitChunkRow {
  id: number;
  file_path: string;
  content: string;
  metadata: {
    startLine?: number;
    endLine?: number;
  } | null;
}

export interface CommitHistoryRow {
  sha: string;
  message: string;
  ai_summary: string | null;
  author_name: string;
  author_avatar_url: string | null;
  committed_at: string;
  files_changed: unknown;
}

export interface CommitFileChange {
  path: string;
  status: string;
  additions: number | null;
  deletions: number | null;
  previous_path: string | null;
  excerpt?: string | null;
}

export interface ResolvedCommitContext {
  sha: string;
  message: string;
  ai_summary: string | null;
  author_name: string;
  author_avatar_url: string | null;
  committed_at: string;
  files_changed: CommitFileChange[];
  sourceMode: ChatSourceMode;
  citations: RepoCitation[];
  fileContextBlocks: string;
}

export type ChatIntentKind =
  | "latest_commit"
  | "specific_commit"
  | "all_commits"
  | "recent_history"
  | "general";

export interface ChatQueryIntent {
  kind: ChatIntentKind;
  wantsTable: boolean;
  wantsBullets: boolean;
  wantsTimelineVisual: boolean;
  wantsArchitectureVisual: boolean;
  wantsFileList: boolean;
  commitReference: string | null;
  scopeToPriorCommit: boolean;
}

interface ScopedCommitAnswerResponse {
  overall_summary: string;
  file_summaries: Array<{
    path: string;
    summary: string;
    likely_user_facing: boolean;
  }>;
  limitations: string;
}

const ALL_COMMITS_PATTERNS =
  /\b(all|every|entire|full)\b.*\b(commit|commits|history|timeline)\b|\bcommit history\b/i;
const LATEST_COMMIT_PATTERNS =
  /\b(last|latest|most recent|newest)\b.*\bcommit\b|\bcommit\b.*\b(last|latest|most recent|newest)\b/i;
const SPECIFIC_COMMIT_PATTERNS = /\b[0-9a-f]{7,40}\b/i;
const PRIOR_COMMIT_PATTERNS =
  /\b(that|this|same|it)\b.*\b(commit|change|file|files)\b|\bfor that commit\b|\bthat file\b|\bthose files\b/i;
const TABLE_PATTERNS = /\btable|tabular|column\b/i;
const BULLET_PATTERNS = /\bbullet|bullets|list\b/i;
const TIMELINE_PATTERNS =
  /\b(timeline|history|recent commits|change over time|progression)\b/i;
const ARCHITECTURE_VISUAL_PATTERNS =
  /\b(diagram|mermaid|chart|visualize|map out|flow|path|graph|trace)\b/i;
const FILE_LIST_PATTERNS = /\b(file|files|modified|changed|touched|affected)\b/i;

const SCOPED_COMMIT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    overall_summary: { type: Type.STRING },
    file_summaries: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING },
          summary: { type: Type.STRING },
          likely_user_facing: { type: Type.BOOLEAN },
        },
        required: ["path", "summary", "likely_user_facing"],
      },
    },
    limitations: { type: Type.STRING },
  },
  required: ["overall_summary", "file_summaries", "limitations"],
};

function parseChunkMetadata(
  metadata: CommitChunkRow["metadata"]
): { startLine: number; endLine: number } {
  return {
    startLine: typeof metadata?.startLine === "number" ? metadata.startLine : 1,
    endLine:
      typeof metadata?.endLine === "number"
        ? metadata.endLine
        : typeof metadata?.startLine === "number"
          ? metadata.startLine
          : 1,
  };
}

export function detectChatQueryIntent(query: string): ChatQueryIntent {
  const commitReference = query.match(SPECIFIC_COMMIT_PATTERNS)?.[0] || null;
  const scopeToPriorCommit = PRIOR_COMMIT_PATTERNS.test(query);

  let kind: ChatIntentKind = "general";
  if (ALL_COMMITS_PATTERNS.test(query)) {
    kind = "all_commits";
  } else if (commitReference || scopeToPriorCommit) {
    kind = "specific_commit";
  } else if (LATEST_COMMIT_PATTERNS.test(query)) {
    kind = "latest_commit";
  } else if (TIMELINE_PATTERNS.test(query) || /\bcommits\b/i.test(query)) {
    kind = "recent_history";
  }

  return {
    kind,
    wantsTable: TABLE_PATTERNS.test(query),
    wantsBullets: BULLET_PATTERNS.test(query),
    wantsTimelineVisual: TIMELINE_PATTERNS.test(query) || kind === "all_commits",
    wantsArchitectureVisual: ARCHITECTURE_VISUAL_PATTERNS.test(query),
    wantsFileList: FILE_LIST_PATTERNS.test(query),
    commitReference,
    scopeToPriorCommit,
  };
}

export function buildChatAnswerInstruction(intent: ChatQueryIntent): string {
  if (intent.wantsTable) {
    return "Format the main result as a compact Markdown table.";
  }
  if (intent.wantsBullets || intent.kind === "all_commits" || intent.kind === "recent_history") {
    return "Format the main result as flat Markdown bullets.";
  }
  return "Use a short paragraph unless the answer is naturally list-shaped.";
}

function normalizeCommitFiles(filesChanged: unknown): CommitFileChange[] {
  if (!Array.isArray(filesChanged)) return [];

  return filesChanged
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      path: typeof entry.path === "string" ? entry.path : "unknown",
      status: typeof entry.status === "string" ? entry.status : "modified",
      additions: typeof entry.additions === "number" ? entry.additions : null,
      deletions: typeof entry.deletions === "number" ? entry.deletions : null,
      previous_path:
        typeof entry.previous_path === "string"
          ? entry.previous_path
          : typeof entry.previous_filename === "string"
            ? entry.previous_filename
            : null,
    }))
    .filter((entry) => entry.path !== "unknown");
}

function normalizeLiveCommitFiles(files: GitHubChangedFile[] | undefined): CommitFileChange[] {
  return (files || []).map((file) => ({
    path: file.filename,
    status: file.status,
    additions: typeof file.additions === "number" ? file.additions : null,
    deletions: typeof file.deletions === "number" ? file.deletions : null,
    previous_path: file.previous_filename || null,
  }));
}

export async function fetchAllCommitHistory(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string
): Promise<CommitHistoryRow[]> {
  const pageSize = 200;
  const commits: CommitHistoryRow[] = [];

  for (let offset = 0; offset < 1000; offset += pageSize) {
    const { data, error } = await supabase
      .from("repo_commits")
      .select(
        "sha, message, ai_summary, author_name, author_avatar_url, committed_at, files_changed"
      )
      .eq("user_id", userId)
      .eq("repo_full_name", repoFullName)
      .neq("author_name", "system")
      .order("committed_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    const rows = (data || []) as CommitHistoryRow[];
    commits.push(...rows);
    if (rows.length < pageSize) break;
  }

  return commits;
}

export function formatCommitHistoryResponse(
  commits: CommitHistoryRow[],
  intent: ChatQueryIntent
): string {
  if (commits.length === 0) {
    return "Insufficient evidence. No tracked commit history was available for this repository.";
  }

  const lines = [`I found ${commits.length} tracked commit${commits.length === 1 ? "" : "s"} in this repository.`, ""];

  if (intent.wantsTable && commits.length <= 40) {
    lines.push("| SHA | Date | Author | Summary | Files |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const commit of commits) {
      const summary = (commit.ai_summary || commit.message.split("\n")[0]).replace(/\|/g, "\\|");
      const files = normalizeCommitFiles(commit.files_changed)
        .slice(0, 4)
        .map((file) => `\`${file.path}\``)
        .join(", ");
      lines.push(
        `| \`${commit.sha.slice(0, 7)}\` | ${new Date(commit.committed_at).toISOString().replace("T", " ").slice(0, 19)} | ${commit.author_name} | ${summary} | ${files || "n/a"} |`
      );
    }
    return lines.join("\n");
  }

  for (const commit of commits) {
    const summary = commit.ai_summary || commit.message.split("\n")[0];
    const files = normalizeCommitFiles(commit.files_changed)
      .slice(0, 6)
      .map((file) => `\`${file.path}\``)
      .join(", ");
    lines.push(
      `- \`${commit.sha.slice(0, 7)}\` | ${new Date(commit.committed_at).toISOString().replace("T", " ").slice(0, 19)} | ${commit.author_name}\n  ${summary}${files ? `\n  Files: ${files}` : ""}`
    );
  }

  return lines.join("\n");
}

async function findIndexedCommitRow(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string,
  shaPrefix: string
): Promise<CommitHistoryRow | null> {
  const { data } = await supabase
    .from("repo_commits")
    .select(
      "sha, message, ai_summary, author_name, author_avatar_url, committed_at, files_changed"
    )
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName)
    .ilike("sha", `${shaPrefix}%`)
    .order("committed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as CommitHistoryRow | null) || null;
}

function buildFreshnessMeta(params: {
  repo: RepoRow | null;
  liveHeadSha: string | null;
  githubToken: string | null;
}): ChatFreshnessMeta | null {
  const { repo, liveHeadSha, githubToken } = params;
  if (!repo) return null;

  const branch = repo.watched_branch || repo.default_branch || "main";
  const stale =
    !!liveHeadSha && !!repo.last_synced_sha && repo.last_synced_sha !== liveHeadSha;

  return {
    branch,
    indexedSha: repo.last_synced_sha || null,
    liveHeadSha,
    stale,
    note: stale
      ? `GitHub HEAD is ${liveHeadSha?.slice(0, 7)} on ${branch}, newer than the indexed commit ${repo.last_synced_sha?.slice(0, 7)}.`
      : githubToken
        ? `Indexed data is aligned with GitHub HEAD on ${branch}.`
        : "Using indexed repository data because no GitHub token is available for live freshness checks.",
  };
}

function buildConversationHistory(messages: PersistedChatMessage[]): string {
  return buildConversationHistoryBlock(messages);
}

async function enrichIndexedCommitWithCitations(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  repo: RepoRow | null;
  commit: ResolvedCommitContext;
}): Promise<ResolvedCommitContext> {
  const { supabase, userId, repoFullName, repo, commit } = params;

  if (!repo?.last_synced_sha || repo.last_synced_sha !== commit.sha) {
    return commit;
  }

  const filePaths = commit.files_changed.map((file) => file.path).slice(0, 8);
  if (filePaths.length === 0) return commit;

  const { data } = await supabase
    .from("repo_chunks")
    .select("id, file_path, content, metadata")
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName)
    .eq("chunk_index", 0)
    .in("file_path", filePaths);

  const rows = (data || []) as CommitChunkRow[];
  if (rows.length === 0) return commit;

  const rowMap = new Map(rows.map((row) => [row.file_path, row]));
  const citations: RepoCitation[] = [];

  const filesChanged = commit.files_changed.map((file, index) => {
    const row = rowMap.get(file.path);
    if (!row) return file;

    const lines = parseChunkMetadata(row.metadata);
    const snippet = stripChunkFileHeader(row.content);
    const lineEnd = Math.max(lines.endLine, lines.startLine + snippet.split("\n").length - 1);

    citations.push({
      citation_id: `commit-${commit.sha}-${index}`,
      index_version_id: repo.last_synced_sha || repo.last_indexed_at || null,
      commit_sha: commit.sha,
      file_path: row.file_path,
      line_start: lines.startLine,
      line_end: lineEnd,
      language: detectCodeLanguage(row.file_path),
      snippet,
      retrieval_score: 0.95 - index * 0.02,
      github_url: buildGitHubBlobUrl(
        repoFullName,
        commit.sha,
        row.file_path,
        lines.startLine,
        lineEnd
      ),
    });

    return {
      ...file,
      excerpt: snippet,
    };
  });

  return {
    ...commit,
    files_changed: filesChanged,
    citations,
    fileContextBlocks: filesChanged
      .filter((file) => file.excerpt)
      .map(
        (file) =>
          `--- Changed file context: ${file.path} (${file.status}) ---\n${truncatePromptText(file.excerpt || "", 1800)}`
      )
      .join("\n\n"),
  };
}

async function enrichLiveCommitWithFileContext(params: {
  token: string;
  repoFullName: string;
  commit: ResolvedCommitContext;
}): Promise<ResolvedCommitContext> {
  const { token, repoFullName, commit } = params;
  const [owner, name] = repoFullName.split("/");

  const parts = await Promise.all(
    commit.files_changed
      .filter((file) => file.status !== "removed")
      .slice(0, 6)
      .map(async (file) => {
        try {
          const content = await fetchFileContent(token, owner, name, file.path, commit.sha);
          if (!content) return null;
          return {
            path: file.path,
            excerpt: truncatePromptText(content, 1800),
          };
        } catch {
          return null;
        }
      })
  );

  const excerptMap = new Map(
    parts
      .filter((entry): entry is { path: string; excerpt: string } => !!entry)
      .map((entry) => [entry.path, entry.excerpt])
  );

  const filesChanged = commit.files_changed.map((file) => ({
    ...file,
    excerpt: excerptMap.get(file.path) || null,
  }));

  return {
    ...commit,
    files_changed: filesChanged,
    fileContextBlocks: filesChanged
      .filter((file) => file.excerpt)
      .map(
        (file) =>
          `--- Live changed file context: ${file.path} (${file.status}) ---\n${file.excerpt}`
      )
      .join("\n\n"),
  };
}

export async function resolveScopedCommit(params: {
  supabase: SupabaseClient;
  userId: string;
  repoFullName: string;
  repo: RepoRow | null;
  githubToken: string | null;
  intent: ChatQueryIntent;
  conversationHistory: PersistedChatMessage[];
}): Promise<{
  commit: ResolvedCommitContext | null;
  sourceMode: ChatSourceMode;
  freshness: ChatFreshnessMeta | null;
}> {
  const { supabase, userId, repoFullName, repo, githubToken, intent, conversationHistory } = params;
  const lastResolved = findLastResolvedCommit(conversationHistory);
  const branch = repo?.watched_branch || repo?.default_branch || "main";
  let liveHeadSha: string | null = null;

  if (githubToken && (intent.kind === "latest_commit" || lastResolved?.sourceMode === "live")) {
    try {
      const [owner, name] = repoFullName.split("/");
      liveHeadSha = (await fetchLatestCommit(githubToken, owner, name, branch)).sha;
    } catch {
      liveHeadSha = null;
    }
  }

  let commit: ResolvedCommitContext | null = null;
  let sourceMode: ChatSourceMode = "indexed";

  if (intent.kind === "specific_commit") {
    const targetSha = intent.commitReference || lastResolved?.sha || null;
    if (targetSha) {
      const indexed = await findIndexedCommitRow(supabase, userId, repoFullName, targetSha);
      if (indexed) {
        commit = {
          sha: indexed.sha,
          message: indexed.message,
          ai_summary: indexed.ai_summary,
          author_name: indexed.author_name,
          author_avatar_url: indexed.author_avatar_url,
          committed_at: indexed.committed_at,
          files_changed: normalizeCommitFiles(indexed.files_changed),
          sourceMode: "indexed",
          citations: [],
          fileContextBlocks: "",
        };
      } else if (githubToken) {
        try {
          const [owner, name] = repoFullName.split("/");
          const liveCommit = await fetchCommitDetails(githubToken, owner, name, targetSha);
          commit = {
            sha: liveCommit.sha,
            message: liveCommit.commit.message,
            ai_summary: null,
            author_name: liveCommit.author?.login || liveCommit.commit.author.name,
            author_avatar_url: liveCommit.author?.avatar_url || null,
            committed_at: liveCommit.commit.author.date,
            files_changed: normalizeLiveCommitFiles(liveCommit.files),
            sourceMode: "live",
            citations: [],
            fileContextBlocks: "",
          };
          sourceMode = "live";
        } catch {
          commit = null;
        }
      }
    }
  }

  if (!commit && intent.kind === "latest_commit") {
    if (
      githubToken &&
      liveHeadSha &&
      repo?.last_synced_sha &&
      liveHeadSha !== repo.last_synced_sha
    ) {
      try {
        const [owner, name] = repoFullName.split("/");
        const liveCommit = await fetchCommitDetails(githubToken, owner, name, liveHeadSha);
        commit = {
          sha: liveCommit.sha,
          message: liveCommit.commit.message,
          ai_summary: null,
          author_name: liveCommit.author?.login || liveCommit.commit.author.name,
          author_avatar_url: liveCommit.author?.avatar_url || null,
          committed_at: liveCommit.commit.author.date,
          files_changed: normalizeLiveCommitFiles(liveCommit.files),
          sourceMode: "live",
          citations: [],
          fileContextBlocks: "",
        };
        sourceMode = "live";
      } catch {
        commit = null;
      }
    }

    if (!commit) {
      const commits = await fetchAllCommitHistory(supabase, userId, repoFullName);
      const latest = commits[0];
      if (latest) {
        commit = {
          sha: latest.sha,
          message: latest.message,
          ai_summary: latest.ai_summary,
          author_name: latest.author_name,
          author_avatar_url: latest.author_avatar_url,
          committed_at: latest.committed_at,
          files_changed: normalizeCommitFiles(latest.files_changed),
          sourceMode: "indexed",
          citations: [],
          fileContextBlocks: "",
        };
      }
    }
  }

  if (commit?.sourceMode === "indexed") {
    commit = await enrichIndexedCommitWithCitations({
      supabase,
      userId,
      repoFullName,
      repo,
      commit,
    });
  } else if (commit?.sourceMode === "live" && githubToken) {
    commit = await enrichLiveCommitWithFileContext({
      token: githubToken,
      repoFullName,
      commit,
    });
  }

  return {
    commit,
    sourceMode: commit?.sourceMode || sourceMode,
    freshness: buildFreshnessMeta({ repo, liveHeadSha, githubToken }),
  };
}

function buildScopedCommitPrompt(params: {
  repoFullName: string;
  question: string;
  commit: ResolvedCommitContext;
  conversationHistory: PersistedChatMessage[];
}): string {
  const { repoFullName, question, commit, conversationHistory } = params;

  return [
    "Answer the user's question about exactly one commit.",
    "Do not discuss older or newer commits unless the user explicitly asks for comparison.",
    "",
    `Repository: ${repoFullName}`,
    `Question: ${question}`,
    `Commit SHA: ${commit.sha}`,
    `Author: ${commit.author_name}`,
    `Committed at: ${commit.committed_at}`,
    `Commit summary: ${(commit.ai_summary || commit.message.split("\n")[0]).trim()}`,
    "",
    "Changed files:",
    commit.files_changed.length > 0
      ? commit.files_changed
          .map((file, index) => {
            const stats =
              file.additions !== null || file.deletions !== null
                ? ` | +${file.additions ?? 0} / -${file.deletions ?? 0}`
                : "";
            return `${index + 1}. ${file.path} (${file.status}${stats})`;
          })
          .join("\n")
      : "No changed-file list was available for this commit.",
    commit.fileContextBlocks ? `\n${commit.fileContextBlocks}` : "",
    buildConversationHistory(conversationHistory)
      ? `\nRecent chat history (for follow-up resolution only):\n${buildConversationHistory(conversationHistory)}`
      : "",
    "",
    "Return JSON matching the schema.",
    "- overall_summary should be concise and factual.",
    "- file_summaries should cover each changed file you can support from the evidence.",
    "- likely_user_facing should be true only when strongly supported.",
    "- limitations should be an empty string if there is nothing important to note.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function answerScopedCommit(params: {
  apiKey: string;
  repoFullName: string;
  question: string;
  intent: ChatQueryIntent;
  commit: ResolvedCommitContext;
  freshness: ChatFreshnessMeta | null;
  conversationHistory: PersistedChatMessage[];
}): Promise<string> {
  const structured = await generateStructuredJson<ScopedCommitAnswerResponse>(
    params.apiKey,
    buildScopedCommitPrompt(params),
    {
      systemInstruction: buildTaskSystemInstruction({
        task: "grounded_explainer",
        role: "Kontext, a grounded commit explainer",
        mission:
          "Explain one specific commit using only the supplied evidence and keep each file summary concise.",
        outputStyle: [
          "Keep summaries short and specific.",
          "Do not broaden to other commits.",
          "Mark uncertainty briefly when evidence is partial.",
        ],
      }),
      generationConfig: PROMPT_GENERATION_CONFIGS.structuredJson,
      responseSchema: SCOPED_COMMIT_RESPONSE_SCHEMA,
    }
  );

  const intro = `${LATEST_COMMIT_PATTERNS.test(params.question) ? "The latest commit" : "The resolved commit"} is \`${params.commit.sha.slice(0, 7)}\` by ${params.commit.author_name} on ${new Date(params.commit.committed_at).toISOString().replace("T", " ").slice(0, 19)}.${params.freshness?.note ? ` ${params.freshness.note}` : ""}`.trim();
  const lines = [intro, "", structured.overall_summary];
  const summaries = new Map(structured.file_summaries.map((item) => [item.path, item]));

  if (params.commit.files_changed.length > 0) {
    lines.push("");
    if (params.intent.wantsTable) {
      const includeUserFacing = /\buser[- ]?facing|frontend|ui\b/i.test(params.question);
      lines.push(
        includeUserFacing
          ? "| File | Status | Change | Likely user-facing |"
          : "| File | Status | Change |"
      );
      lines.push(
        includeUserFacing
          ? "| --- | --- | --- | --- |"
          : "| --- | --- | --- |"
      );

      for (const file of params.commit.files_changed) {
        const summary = summaries.get(file.path);
        const description =
          summary?.summary || "No concise summary available from the retrieved evidence.";
        lines.push(
          includeUserFacing
            ? `| \`${file.path}\` | ${file.status} | ${description.replace(/\|/g, "\\|")} | ${summary?.likely_user_facing ? "Yes" : "No"} |`
            : `| \`${file.path}\` | ${file.status} | ${description.replace(/\|/g, "\\|")} |`
        );
      }
    } else {
      lines.push("Changed files:");
      for (const file of params.commit.files_changed) {
        const summary = summaries.get(file.path);
        lines.push(
          `- \`${file.path}\`: ${summary?.summary || "No concise summary available from the retrieved evidence."}`
        );
      }
    }
  }

  if (structured.limitations.trim()) {
    lines.push("");
    lines.push(`Note: ${structured.limitations.trim()}`);
  }

  return lines.join("\n");
}
