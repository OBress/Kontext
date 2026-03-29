import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ACTIVITY_EVENT_TYPES, isActivityEventType } from "@/lib/activity";
import { assertRepoTeamAccess, getCurrentOnboardingExperience, listOnboardingAssignments, listOnboardingTemplates } from "@/lib/api/onboarding";
import { ApiError, getApiErrorPayload } from "@/lib/api/errors";
import { buildGraph } from "@/lib/api/graph-builder";
import { fetchCommitsSince, fetchLatestCommit } from "@/lib/api/github";
import { getRepoHealthSummary, ensureRepoCheckConfigs, REPO_CHECK_TYPES, runRepoChecks } from "@/lib/api/repo-checks";
import { rateLimit } from "@/lib/api/rate-limit";
import { resolveRepoGitHubToken } from "@/lib/api/repo-auth";
import { answerRepoQuestion, retrieveRepoContext } from "@/lib/api/repo-intelligence";
import { validateRepoFullName } from "@/lib/api/validate";
import { decryptToken, hashApiKey } from "@/lib/api/crypto";
import { generateQueryEmbedding } from "@/lib/api/embeddings";
import { buildGitHubBlobUrl, detectCodeLanguage, stripChunkFileHeader } from "@/lib/code";
import { getArchitectureSchemaVersion, getArchitectureView, toArchitectureBundle } from "@/types/architecture";

type JsonRpcId = string | number | null;

interface JsonRpcRequestBody {
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

interface RepoRecord {
  github_id: number;
  full_name: string;
  name: string;
  owner: string;
  description: string | null;
  language: string | null;
  stargazers_count: number | null;
  forks_count: number | null;
  updated_at: string;
  indexed: boolean | null;
  indexing: boolean | null;
  chunk_count: number | null;
  last_indexed_at: string | null;
  last_synced_sha: string | null;
  watched_branch: string | null;
  default_branch: string | null;
  auto_sync_enabled: boolean | null;
  understanding_tier: number | null;
  webhook_id: number | null;
  sync_blocked_reason: string | null;
  pending_sync_head_sha: string | null;
  architecture_analysis?: unknown;
  architecture_analyzed_at?: string | null;
  architecture_status?: string | null;
  architecture_for_sha?: string | null;
  architecture_error?: string | null;
}

interface RepoChunkMatch {
  id: number;
  file_path: string;
  content: string;
  similarity: number;
}

interface RepoChunkRow {
  id: number;
  repo_full_name: string;
  file_path: string;
  content: string;
  metadata: Record<string, unknown> | null;
}

interface RepoChunkContentRow {
  repo_full_name: string;
  file_path: string;
  chunk_index: number;
  content: string;
}

interface RepoFileRow {
  repo_full_name: string;
  file_path: string;
  file_name?: string;
  extension: string | null;
  line_count: number | null;
  imports?: string[] | null;
}

interface RepoCommitRow {
  id: number;
  repo_full_name: string;
  sha: string;
  message: string;
  ai_summary: string | null;
  author_name: string;
  author_avatar_url: string | null;
  committed_at: string;
  files_changed: unknown;
  push_group_id: string | null;
  sync_triggered?: boolean | null;
}

interface RepoJobRow {
  id: number;
  repo_full_name: string;
  job_type: string;
  trigger: string;
  status: string;
  title: string | null;
  progress_percent: number;
  result_summary: string | null;
  metadata: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RepoCheckRunRow {
  id: number;
  repo_full_name: string;
  status: string;
  trigger_mode: string;
  summary: string | null;
  head_sha: string | null;
  findings_total: number;
  new_findings: number;
  resolved_findings: number;
  unchanged_findings: number;
  created_at: string;
}

interface RepoCheckFindingRow {
  id: number;
  repo_full_name: string;
  check_type: string;
  title: string;
  summary: string;
  severity: string;
  status: string;
  transition_state: string;
  confidence: number;
  category: string | null;
  file_path: string | null;
  symbol: string | null;
  evidence: string | null;
  recommendation: string | null;
  related_files: string[] | null;
  metadata: Record<string, unknown> | null;
  first_seen_sha: string | null;
  last_seen_sha: string | null;
  fixed_in_sha: string | null;
  last_seen_at: string | null;
  resolved_at: string | null;
  opened_in_run_id: number | null;
  last_run_id: number | null;
  fixed_in_run_id: number | null;
  dismissed_at: string | null;
  dismissed_by: string | null;
  dismissed_reason: string | null;
  updated_at: string;
}

interface ActivityEventRow {
  id: number;
  repo_full_name: string | null;
  event_type: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface TeamMemberRow {
  id: number;
  user_id: string;
  role: string;
  joined_at: string;
}

interface TeamInviteRow {
  id: number;
  github_username: string;
  role: string;
  status: string;
  created_at: string | null;
  onboarding_template_version_id: number | null;
}

interface McpToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpPromptDefinition {
  name: string;
  title?: string;
  description: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

interface McpResourceDefinition {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

interface ChunkMetadata {
  startLine?: number;
  endLine?: number;
}

interface PushGroup {
  push_group_id: string;
  committed_at: string;
  author_name: string;
  author_avatar_url: string | null;
  commit_count: number;
  commits: RepoCommitRow[];
}

interface ParsedKontextResourceUri {
  kind:
    | "dashboard-repos"
    | "dashboard-activity"
    | "repo-overview"
    | "repo-graph"
    | "repo-timeline"
    | "repo-activity"
    | "repo-check-summary"
    | "repo-check-findings"
    | "repo-check-runs"
    | "repo-sync"
    | "repo-team"
    | "repo-onboarding";
  repoFullName?: string;
}

export interface McpAuth {
  keyHash: string;
  userId: string;
  repoFullName: string | null;
  googleAiKey: string | null;
}

export const MCP_SERVER_INFO = {
  name: "kontext-mcp",
  version: "1.1.0",
};

export const MCP_SERVER_CAPABILITIES = {
  tools: { listChanged: false },
  resources: { listChanged: false },
  prompts: { listChanged: false },
};

export const MCP_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

const JSON_MIME_TYPE = "application/json";
const REPOS_RESOURCE_URI = "kontext://dashboard/repos";
const ACTIVITY_RESOURCE_URI = "kontext://dashboard/activity";

let adminDbSingleton: SupabaseClient | null = null;
const lastUsedTouchByKeyHash = new Map<string, number>();

function getAdminDb(): SupabaseClient {
  if (adminDbSingleton) return adminDbSingleton;

  adminDbSingleton = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  return adminDbSingleton;
}

function serializeRepoRecord(repo: RepoRecord) {
  return {
    id: repo.github_id,
    full_name: repo.full_name,
    name: repo.name,
    owner: repo.owner,
    description: repo.description || null,
    language: repo.language || null,
    stargazers_count: repo.stargazers_count || 0,
    forks_count: repo.forks_count || 0,
    updated_at: repo.updated_at,
    indexed: Boolean(repo.indexed),
    indexing: Boolean(repo.indexing),
    chunk_count: repo.chunk_count || 0,
    last_indexed_at: repo.last_indexed_at || null,
    last_synced_sha: repo.last_synced_sha || null,
    watched_branch: repo.watched_branch || null,
    default_branch: repo.default_branch || null,
    auto_sync_enabled: Boolean(repo.auto_sync_enabled),
    understanding_tier: repo.understanding_tier || 2,
    webhook_id: repo.webhook_id || null,
    sync_blocked_reason: repo.sync_blocked_reason || null,
    pending_sync_head_sha: repo.pending_sync_head_sha || null,
  };
}

function normalizeRepoFullName(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return validateRepoFullName(value.trim());
}

export function resolveRepoScope(
  authRepoFullName: string | null,
  requestedRepoFullName: string | null
): string | null {
  const requested = normalizeRepoFullName(requestedRepoFullName);
  const scoped = normalizeRepoFullName(authRepoFullName);

  if (scoped && requested && scoped !== requested) {
    throw new ApiError(
      403,
      "REPO_SCOPE_VIOLATION",
      "This MCP key is scoped to a different repository."
    );
  }

  return scoped || requested || null;
}

function resolveOptionalRepoFullName(
  auth: Pick<McpAuth, "repoFullName">,
  args: Record<string, unknown>
) {
  const requested =
    typeof args.repo_full_name === "string" ? args.repo_full_name : null;

  return resolveRepoScope(auth.repoFullName, requested);
}

function resolveRequiredRepoFullName(
  auth: Pick<McpAuth, "repoFullName">,
  args: Record<string, unknown>
) {
  const repoFullName = resolveOptionalRepoFullName(auth, args);

  if (!repoFullName) {
    throw new ApiError(
      400,
      "REPO_SCOPE_REQUIRED",
      "repo_full_name is required when the MCP key is not already scoped to a repository."
    );
  }

  return repoFullName;
}

function parseChunkMetadata(
  metadata: Record<string, unknown> | null
): ChunkMetadata {
  if (!metadata) return {};

  return {
    startLine:
      typeof metadata.startLine === "number" ? metadata.startLine : undefined,
    endLine:
      typeof metadata.endLine === "number" ? metadata.endLine : undefined,
  };
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function parsePositiveInt(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
) {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(normalized)) return fallback;

  return Math.min(Math.max(Math.trunc(normalized), minimum), maximum);
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function buildJsonRpcResult(id: JsonRpcId, result: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id,
    result,
  };
}

function buildToolResultPayload(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

function buildJsonRpcError(id: JsonRpcId, error: unknown) {
  const payload = getApiErrorPayload(error);

  return {
    jsonrpc: "2.0" as const,
    id,
    error: {
      code: payload.code.startsWith("AI_") ? -32001 : -32000,
      message: payload.message,
      data: payload,
    },
  };
}

async function touchMcpKeyLastUsed(
  supabase: SupabaseClient,
  keyHash: string
): Promise<void> {
  const now = Date.now();
  const lastTouch = lastUsedTouchByKeyHash.get(keyHash) || 0;

  if (now - lastTouch < 60_000) return;
  lastUsedTouchByKeyHash.set(keyHash, now);

  try {
    await supabase
      .from("mcp_api_keys")
      .update({ last_used_at: new Date(now).toISOString() })
      .eq("key_hash", keyHash);
  } catch {
    // Best effort only.
  }
}

async function resolveStoredGitHubToken(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data: tokenRow } = await supabase
    .from("user_tokens")
    .select("encrypted_token, token_iv, token_tag")
    .eq("user_id", userId)
    .eq("provider", "github")
    .maybeSingle();

  if (
    !tokenRow?.encrypted_token ||
    !tokenRow?.token_iv ||
    !tokenRow?.token_tag
  ) {
    return null;
  }

  try {
    return decryptToken({
      ciphertext: tokenRow.encrypted_token,
      iv: tokenRow.token_iv,
      tag: tokenRow.token_tag,
    });
  } catch {
    return null;
  }
}

async function resolveEffectiveGitHubToken(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string
) {
  const oauthToken = await resolveStoredGitHubToken(supabase, userId);
  return resolveRepoGitHubToken(supabase, userId, repoFullName, oauthToken);
}

async function getRepoRecordOrThrow(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string,
  fields = "*"
) {
  const { data: repo } = await supabase
    .from("repos")
    .select(fields)
    .eq("user_id", userId)
    .eq("full_name", repoFullName)
    .maybeSingle();

  if (!repo) {
    throw new ApiError(404, "NOT_FOUND", "Repository not found.");
  }

  return repo as RepoRecord;
}

async function listRepos(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const repoFullName = resolveOptionalRepoFullName(auth, args);
  const limit = parsePositiveInt(args.limit, 100, 1, 250);

  let query = supabase
    .from("repos")
    .select("*")
    .eq("user_id", auth.userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (repoFullName) {
    query = query.eq("full_name", repoFullName);
  }

  const { data } = await query;
  return { repos: ((data || []) as RepoRecord[]).map(serializeRepoRecord) };
}

export async function validateMcpAuth(
  request: Request
): Promise<McpAuth | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer kt_")) return null;

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey) return null;

  const keyHash = hashApiKey(rawKey);
  const supabase = getAdminDb();

  const { data: keyRow } = await supabase
    .from("mcp_api_keys")
    .select("user_id, repo_full_name, expires_at")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (!keyRow) return null;
  if (keyRow.expires_at && new Date(keyRow.expires_at) <= new Date()) {
    return null;
  }

  const { data: tokenRow } = await supabase
    .from("user_tokens")
    .select("google_ai_key")
    .eq("user_id", keyRow.user_id)
    .eq("provider", "github")
    .maybeSingle();

  void touchMcpKeyLastUsed(supabase, keyHash);

  return {
    keyHash,
    userId: keyRow.user_id,
    repoFullName: keyRow.repo_full_name || null,
    googleAiKey: tokenRow?.google_ai_key || null,
  };
}

async function searchIndexedCode(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  if (!auth.googleAiKey) {
    throw new ApiError(
      400,
      "API_KEY_REQUIRED",
      "Google AI key not configured. Add it in Kontext settings."
    );
  }

  const repoFullName = resolveOptionalRepoFullName(auth, args);
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const maxResults = parsePositiveInt(args.max_results, 5, 1, 20);

  if (!query) {
    throw new ApiError(400, "QUERY_REQUIRED", "query is required.");
  }

  const queryEmbedding = await generateQueryEmbedding(
    auth.googleAiKey,
    query,
    "RETRIEVAL_QUERY"
  );

  const { data: matches } = await supabase.rpc("hybrid_match_chunks", {
    query_text: query,
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: maxResults,
    filter_repo: repoFullName,
    filter_user_id: auth.userId,
  });

  const chunkMatches = (matches || []) as RepoChunkMatch[];
  if (chunkMatches.length === 0) return { repo_full_name: repoFullName, results: [] };

  const chunkIds = chunkMatches.map((match) => match.id);
  const { data: chunkRows } = await supabase
    .from("repo_chunks")
    .select("id, repo_full_name, file_path, content, metadata")
    .in("id", chunkIds);

  const detailsById = new Map<number, RepoChunkRow>();
  for (const row of (chunkRows || []) as RepoChunkRow[]) {
    detailsById.set(row.id, row);
  }

  const matchedRepoNames = uniqueStrings(
    (chunkRows || []).map((row) => (row as RepoChunkRow).repo_full_name)
  );

  const { data: repoRows } =
    matchedRepoNames.length === 0
      ? { data: [] as RepoRecord[] }
      : await supabase
          .from("repos")
          .select("full_name, last_synced_sha, last_indexed_at")
          .eq("user_id", auth.userId)
          .in("full_name", matchedRepoNames);

  const repoVersionByName = new Map<
    string,
    { last_synced_sha: string | null; last_indexed_at: string | null }
  >();
  for (const row of (repoRows || []) as Array<{
    full_name: string;
    last_synced_sha: string | null;
    last_indexed_at: string | null;
  }>) {
    repoVersionByName.set(row.full_name, {
      last_synced_sha: row.last_synced_sha,
      last_indexed_at: row.last_indexed_at,
    });
  }

  return {
    repo_full_name: repoFullName,
    results: chunkMatches.map((match, index) => {
      const detail = detailsById.get(match.id);
      const metadata = parseChunkMetadata(detail?.metadata || null);
      const scopedRepoFullName = detail?.repo_full_name || repoFullName;
      const repoVersion = scopedRepoFullName
        ? repoVersionByName.get(scopedRepoFullName)
        : undefined;
      const snippet = stripChunkFileHeader(detail?.content || match.content);
      const lineStart = metadata.startLine ?? 1;
      const lineEnd =
        metadata.endLine ??
        lineStart + Math.max(snippet.split("\n").length - 1, 0);
      const commitSha = repoVersion?.last_synced_sha || null;

      return {
        citation_id: `${match.id}-${index}`,
        repo_full_name: scopedRepoFullName,
        file_path: detail?.file_path || match.file_path,
        line_start: lineStart,
        line_end: lineEnd,
        language: detectCodeLanguage(detail?.file_path || match.file_path),
        snippet,
        retrieval_score: match.similarity,
        index_version_id: commitSha || repoVersion?.last_indexed_at || null,
        commit_sha: commitSha,
        github_url:
          scopedRepoFullName && commitSha
            ? buildGitHubBlobUrl(
                scopedRepoFullName,
                commitSha,
                detail?.file_path || match.file_path,
                lineStart,
                lineEnd
              )
            : null,
      };
    }),
  };
}

async function getIndexedFile(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const repoFullName = resolveOptionalRepoFullName(auth, args);
  const filePath = typeof args.path === "string" ? args.path.trim() : "";

  if (!filePath) {
    throw new ApiError(400, "PATH_REQUIRED", "path is required.");
  }

  let query = supabase
    .from("repo_chunks")
    .select("repo_full_name, file_path, chunk_index, content")
    .eq("user_id", auth.userId)
    .eq("file_path", filePath)
    .order("chunk_index", { ascending: true });

  if (repoFullName) {
    query = query.eq("repo_full_name", repoFullName);
  }

  const { data } = await query;
  const chunkRows = (data || []) as RepoChunkContentRow[];

  if (chunkRows.length === 0) {
    return { error: "File not found in index" };
  }

  const matchedRepos = uniqueStrings(chunkRows.map((row) => row.repo_full_name));

  if (!repoFullName && matchedRepos.length > 1) {
    return {
      error: "Multiple indexed files match this path. Specify repo_full_name.",
      matches: matchedRepos,
    };
  }

  const effectiveRepoFullName = repoFullName || matchedRepos[0] || null;
  const repo = effectiveRepoFullName
    ? await getRepoRecordOrThrow(
        supabase,
        auth.userId,
        effectiveRepoFullName,
        "full_name, last_synced_sha, last_indexed_at"
      )
    : null;

  return {
    repo_full_name: effectiveRepoFullName,
    file_path: filePath,
    content: chunkRows.map((chunk) => chunk.content).join("\n"),
    chunks: chunkRows.length,
    language: detectCodeLanguage(filePath),
    commit_sha: repo?.last_synced_sha || null,
    index_version_id: repo?.last_synced_sha || repo?.last_indexed_at || null,
    github_url: effectiveRepoFullName
      ? buildGitHubBlobUrl(
          effectiveRepoFullName,
          repo?.last_synced_sha || null,
          filePath
        )
      : null,
  };
}

async function listIndexedFiles(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const repoFullName = resolveOptionalRepoFullName(auth, args);
  const limit = parsePositiveInt(args.limit, 200, 1, 500);

  let query = supabase
    .from("repo_files")
    .select("repo_full_name, file_path, extension, line_count")
    .eq("user_id", auth.userId)
    .order("repo_full_name", { ascending: true })
    .order("file_path", { ascending: true })
    .limit(limit);

  if (repoFullName) {
    query = query.eq("repo_full_name", repoFullName);
  }

  const pattern = typeof args.pattern === "string" ? args.pattern.trim() : "";
  if (pattern) {
    const likePattern = pattern.replace(/\*/g, "%").replace(/\?/g, "_");
    query = query.like("file_path", likePattern);
  }

  const { data } = await query;
  return {
    repo_full_name: repoFullName,
    files: (data || []) as Array<{
      repo_full_name: string;
      file_path: string;
      extension: string | null;
      line_count: number | null;
    }>,
  };
}

async function askRepositoryQuestion(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  if (!auth.googleAiKey) {
    throw new ApiError(
      400,
      "API_KEY_REQUIRED",
      "Google AI key not configured. Add it in Kontext settings."
    );
  }

  const repoFullName = resolveOptionalRepoFullName(auth, args);
  const question =
    typeof args.question === "string" ? args.question.trim() : "";

  if (!question) {
    throw new ApiError(400, "QUESTION_REQUIRED", "question is required.");
  }

  const context = await retrieveRepoContext({
    supabase,
    userId: auth.userId,
    repoFullName,
    query: question,
    apiKey: auth.googleAiKey,
    includeTimeline: true,
    matchCount: 12,
  });

  const hasContext =
    context.dedupedCitations.length > 0 || context.hasSupplementalContext;

  const answer = !hasContext
    ? "Insufficient evidence from the indexed repository."
    : await answerRepoQuestion({
        apiKey: auth.googleAiKey,
        repoFullName: context.repoLabel,
        question,
        fileManifest: context.fileManifest,
        contextBlocks: context.contextBlocks,
        timelineBlocks: context.timelineBlocks,
        recentCommitsBlock: context.recentCommitsBlock || undefined,
        architectureBlock: context.architectureBlock || undefined,
        healthFindingsBlock: context.healthFindingsBlock || undefined,
        activityBlock: context.activityBlock || undefined,
        repoMetadataBlock: context.repoMetadataBlock || undefined,
      });

  return {
    repo_full_name: repoFullName,
    answer,
    sources: context.dedupedCitations,
    timeline: context.timelineCitations,
    answerMode: context.answerMode,
  };
}

async function getRepositoryGraph(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const repoFullName = resolveRequiredRepoFullName(auth, args);

  const [repoData, fileData] = await Promise.all([
    getRepoRecordOrThrow(
      supabase,
      auth.userId,
      repoFullName,
      "architecture_analysis, architecture_analyzed_at, architecture_status, architecture_for_sha, architecture_error, last_synced_sha"
    ),
    supabase
      .from("repo_files")
      .select("repo_full_name, file_path, file_name, extension, line_count, imports")
      .eq("user_id", auth.userId)
      .eq("repo_full_name", repoFullName),
  ]);

  const files = (fileData.data || []) as RepoFileRow[];
  const rawArchitecture = repoData.architecture_analysis || null;
  const architectureBundle = toArchitectureBundle(rawArchitecture);
  const schemaVersion = getArchitectureSchemaVersion(rawArchitecture);
  const hasLegacyBundle =
    !!rawArchitecture && schemaVersion !== null && schemaVersion < 3;

  const architectureStatus =
    hasLegacyBundle
      ? "stale"
      : repoData.architecture_status || (architectureBundle ? "ready" : "missing");
  const architectureForSha =
    repoData.architecture_for_sha || architectureBundle?.sourceSha || null;
  const isStale =
    hasLegacyBundle ||
    architectureStatus === "stale" ||
    (!!repoData.last_synced_sha && architectureForSha !== repoData.last_synced_sha);
  const architectureError = hasLegacyBundle
    ? "Architecture map is on an older schema and needs to be regenerated."
    : repoData.architecture_error || null;

  if (files.length === 0) {
    return {
      repo_full_name: repoFullName,
      nodes: [],
      links: [],
      architecture: getArchitectureView(architectureBundle, "system"),
      architectureBundle,
      architectureStatus,
      architectureForSha,
      architectureError,
      analyzedAt: repoData.architecture_analyzed_at || null,
      isStale,
      message: "No file data available. Index the repository first.",
    };
  }

  const graph = buildGraph(files);
  return {
    repo_full_name: repoFullName,
    ...graph,
    architecture: getArchitectureView(architectureBundle, "system"),
    architectureBundle,
    architectureStatus,
    architectureForSha,
    architectureError,
    analyzedAt: repoData.architecture_analyzed_at || null,
    isStale,
  };
}

async function getRepositoryTimeline(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const repoFullName = resolveRequiredRepoFullName(auth, args);
  const limit = parsePositiveInt(args.limit, 50, 1, 100);
  const offset = parsePositiveInt(args.offset, 0, 0, 10_000);

  const [commitPage, totalCommits, syncedCommits, pendingSummaries] =
    await Promise.all([
      supabase
        .from("repo_commits")
        .select("*", { count: "exact" })
        .eq("user_id", auth.userId)
        .eq("repo_full_name", repoFullName)
        .neq("author_name", "system")
        .order("committed_at", { ascending: false })
        .range(offset, offset + limit - 1),
      supabase
        .from("repo_commits")
        .select("id", { count: "exact", head: true })
        .eq("user_id", auth.userId)
        .eq("repo_full_name", repoFullName)
        .neq("author_name", "system"),
      supabase
        .from("repo_commits")
        .select("id", { count: "exact", head: true })
        .eq("user_id", auth.userId)
        .eq("repo_full_name", repoFullName)
        .neq("author_name", "system")
        .eq("sync_triggered", true),
      supabase
        .from("repo_commits")
        .select("id", { count: "exact", head: true })
        .eq("user_id", auth.userId)
        .eq("repo_full_name", repoFullName)
        .neq("author_name", "system")
        .is("ai_summary", null),
    ]);

  const commits = (commitPage.data || []) as RepoCommitRow[];
  const groupMap = new Map<string, PushGroup>();
  const ungrouped: RepoCommitRow[] = [];

  for (const commit of commits) {
    const groupId = commit.push_group_id;
    if (!groupId || groupId.startsWith("ingest-")) {
      ungrouped.push(commit);
      continue;
    }

    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, {
        push_group_id: groupId,
        committed_at: commit.committed_at,
        author_name: commit.author_name,
        author_avatar_url: commit.author_avatar_url,
        commit_count: 0,
        commits: [],
      });
    }

    const group = groupMap.get(groupId);
    if (!group) continue;

    group.commits.push(commit);
    group.commit_count = group.commits.length;

    if (new Date(commit.committed_at) > new Date(group.committed_at)) {
      group.committed_at = commit.committed_at;
    }
  }

  for (const commit of ungrouped) {
    groupMap.set(`solo-${commit.sha}`, {
      push_group_id: `solo-${commit.sha}`,
      committed_at: commit.committed_at,
      author_name: commit.author_name,
      author_avatar_url: commit.author_avatar_url,
      commit_count: 1,
      commits: [commit],
    });
  }

  const pushGroups = [...groupMap.values()].sort(
    (left, right) =>
      new Date(right.committed_at).getTime() -
      new Date(left.committed_at).getTime()
  );

  return {
    repo_full_name: repoFullName,
    pushGroups,
    commits,
    pagination: {
      total: commitPage.count || 0,
      limit,
      offset,
      hasMore: (commitPage.count || 0) > offset + limit,
    },
    stats: {
      totalCommits: totalCommits.count || 0,
      syncedCommits: syncedCommits.count || 0,
      pendingSummaries: pendingSummaries.count || 0,
    },
  };
}

async function getRecentActivity(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const repoFullName = resolveOptionalRepoFullName(auth, args);
  const limit = parsePositiveInt(args.limit, 20, 1, 50);

  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("activity_filters")
    .eq("user_id", auth.userId)
    .maybeSingle();

  let enabledTypes = [...ACTIVITY_EVENT_TYPES];
  if (prefs?.activity_filters) {
    const filters = prefs.activity_filters as Record<string, boolean>;
    enabledTypes = ACTIVITY_EVENT_TYPES.filter((type) => filters[type] !== false);
  }

  const requestedTypes = parseStringArray(args.event_types).filter(
    isActivityEventType
  );

  if (requestedTypes.length > 0) {
    enabledTypes = requestedTypes.filter((type) => enabledTypes.includes(type));
  }

  if (enabledTypes.length === 0) {
    return { repo_full_name: repoFullName, events: [] };
  }

  let query = supabase
    .from("activity_events")
    .select("*")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .in("event_type", enabledTypes);

  if (repoFullName) {
    query = query.eq("repo_full_name", repoFullName);
  }

  const { data } = await query;
  return {
    repo_full_name: repoFullName,
    events: (data || []) as ActivityEventRow[],
  };
}

async function getRepositoryHealth(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const repoFullName = resolveRequiredRepoFullName(auth, args);
  return {
    repo_full_name: repoFullName,
    ...(await getRepoHealthSummary(supabase, auth.userId, repoFullName)),
  };
}

async function listRepoFindings(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const repoFullName = resolveOptionalRepoFullName(auth, args);
  const limit = parsePositiveInt(args.limit, 20, 1, 100);
  const includeDismissed = args.include_dismissed === true;
  const checkType =
    typeof args.check_type === "string" &&
    REPO_CHECK_TYPES.includes(args.check_type as (typeof REPO_CHECK_TYPES)[number])
      ? args.check_type
      : null;

  let query = supabase
    .from("repo_check_findings")
    .select("*")
    .eq("user_id", auth.userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (repoFullName) {
    query = query.eq("repo_full_name", repoFullName);
  }

  if (!includeDismissed) {
    query = query.is("dismissed_at", null);
  }

  if (args.status === "open" || args.status === "resolved") {
    query = query.eq("status", args.status);
  }

  if (checkType) {
    query = query.eq("check_type", checkType);
  }

  const { data } = await query;
  return {
    repo_full_name: repoFullName,
    findings: (data || []) as RepoCheckFindingRow[],
  };
}

async function getFindingById(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const findingId = parsePositiveInt(args.finding_id, 0, 1, Number.MAX_SAFE_INTEGER);
  if (!findingId) {
    throw new ApiError(400, "FINDING_ID_REQUIRED", "finding_id is required.");
  }

  const { data } = await supabase
    .from("repo_check_findings")
    .select("*")
    .eq("user_id", auth.userId)
    .eq("id", findingId)
    .maybeSingle();

  return data || { error: "Finding not found" };
}

async function listCheckRuns(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const repoFullName = resolveOptionalRepoFullName(auth, args);
  const limit = parsePositiveInt(args.limit, 20, 1, 50);

  let query = supabase
    .from("repo_check_runs")
    .select("*")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (repoFullName) {
    query = query.eq("repo_full_name", repoFullName);
  }

  const { data } = await query;
  return {
    repo_full_name: repoFullName,
    runs: (data || []) as RepoCheckRunRow[],
  };
}

async function listCheckConfigs(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const repoFullName = resolveRequiredRepoFullName(auth, args);
  const configs = await ensureRepoCheckConfigs(supabase, auth.userId, repoFullName);

  return {
    repo_full_name: repoFullName,
    configs,
  };
}

async function getRepositoryOverview(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const repoFullName = resolveRequiredRepoFullName(auth, args);

  const [repo, syncJobResult, checkRunsResult, activityResult, commitsResult] =
    await Promise.all([
      getRepoRecordOrThrow(supabase, auth.userId, repoFullName),
      supabase
        .from("repo_jobs")
        .select("*")
        .eq("user_id", auth.userId)
        .eq("repo_full_name", repoFullName)
        .eq("job_type", "sync")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("repo_check_runs")
        .select("*")
        .eq("user_id", auth.userId)
        .eq("repo_full_name", repoFullName)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("activity_events")
        .select("*")
        .eq("user_id", auth.userId)
        .eq("repo_full_name", repoFullName)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("repo_commits")
        .select("*")
        .eq("user_id", auth.userId)
        .eq("repo_full_name", repoFullName)
        .neq("author_name", "system")
        .order("committed_at", { ascending: false })
        .limit(8),
    ]);

  const health = await getRepoHealthSummary(supabase, auth.userId, repoFullName);

  return {
    repo: serializeRepoRecord(repo),
    sync: {
      last_synced_sha: repo.last_synced_sha || null,
      watched_branch: repo.watched_branch || null,
      default_branch: repo.default_branch || null,
      auto_sync_enabled: Boolean(repo.auto_sync_enabled),
      sync_blocked_reason: repo.sync_blocked_reason || null,
      pending_sync_head_sha: repo.pending_sync_head_sha || null,
      latest_job: (syncJobResult.data || null) as RepoJobRow | null,
    },
    health,
    latest_check_runs: (checkRunsResult.data || []) as RepoCheckRunRow[],
    recent_activity: (activityResult.data || []) as ActivityEventRow[],
    recent_commits: (commitsResult.data || []) as RepoCommitRow[],
  };
}

async function getSyncStatus(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const repoFullName = resolveRequiredRepoFullName(auth, args);
  const [repo, syncJobResult] = await Promise.all([
    getRepoRecordOrThrow(
      supabase,
      auth.userId,
      repoFullName,
      "full_name, owner, name, last_synced_sha, watched_branch, default_branch, auto_sync_enabled, understanding_tier, sync_blocked_reason, pending_sync_head_sha"
    ),
    supabase
      .from("repo_jobs")
      .select("*")
      .eq("user_id", auth.userId)
      .eq("repo_full_name", repoFullName)
      .eq("job_type", "sync")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const basePayload = {
    repo_full_name: repoFullName,
    branch: repo.watched_branch || repo.default_branch || "main",
    autoSyncEnabled: Boolean(repo.auto_sync_enabled),
    understandingTier: repo.understanding_tier || 2,
    lastSyncedSha: repo.last_synced_sha || null,
    syncBlockedReason: repo.sync_blocked_reason || null,
    pendingSyncHeadSha: repo.pending_sync_head_sha || null,
    latestSyncJob: (syncJobResult.data || null) as RepoJobRow | null,
    live: {
      source: "stored" as const,
      hasUpdates: null,
      currentSha: null,
      newCommitCount: null,
      latestMessage: null,
      latestAuthor: null,
      latestDate: null,
      error: null as string | null,
    },
  };

  try {
    const { token: effectiveToken, source } = await resolveEffectiveGitHubToken(
      supabase,
      auth.userId,
      repoFullName
    );

    if (!effectiveToken) {
      return basePayload;
    }

    const latest = await fetchLatestCommit(
      effectiveToken,
      repo.owner,
      repo.name,
      basePayload.branch
    );

    const hasUpdates = repo.last_synced_sha !== latest.sha;
    let newCommitCount = 0;

    if (hasUpdates && repo.last_synced_sha) {
      const newCommits = await fetchCommitsSince(
        effectiveToken,
        repo.owner,
        repo.name,
        basePayload.branch,
        repo.last_synced_sha
      );
      newCommitCount = newCommits.length;
    }

    return {
      ...basePayload,
      live: {
        source,
        hasUpdates,
        currentSha: latest.sha,
        newCommitCount,
        latestMessage: latest.commit.message.split("\n")[0],
        latestAuthor: latest.author?.login || latest.commit.author.name,
        latestDate: latest.commit.author.date,
        error: null,
      },
    };
  } catch (error: unknown) {
    return {
      ...basePayload,
      live: {
        ...basePayload.live,
        error:
          error instanceof Error
            ? error.message
            : "Unable to fetch the latest upstream commit state.",
      },
    };
  }
}

async function getTeamWorkspace(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const repoFullName = resolveRequiredRepoFullName(auth, args);

  const callerRole = await assertRepoTeamAccess(
    supabase,
    auth.userId,
    repoFullName,
    ["owner", "admin", "member", "viewer"]
  );

  const [memberRows, inviteRows, templates, assignments] = await Promise.all([
    supabase
      .from("team_members")
      .select("id, user_id, role, joined_at")
      .eq("repo_full_name", repoFullName)
      .order("joined_at", { ascending: true }),
    callerRole === "owner" || callerRole === "admin"
      ? supabase
          .from("team_invites")
          .select(
            "id, github_username, role, status, created_at, onboarding_template_version_id"
          )
          .eq("repo_full_name", repoFullName)
          .eq("status", "pending")
      : Promise.resolve({
          data: [] as TeamInviteRow[],
          error: null,
          count: null,
          status: 200,
          statusText: "OK",
        }),
    listOnboardingTemplates(supabase, auth.userId, repoFullName),
    listOnboardingAssignments(supabase, auth.userId, repoFullName),
  ]);

  return {
    repo_full_name: repoFullName,
    callerRole,
    members: (memberRows.data || []) as TeamMemberRow[],
    invites: (inviteRows.data || []) as TeamInviteRow[],
    onboarding: {
      ...templates,
      ...assignments,
    },
  };
}

async function getOnboardingExperience(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const repoFullName = resolveRequiredRepoFullName(auth, args);
  const experience = await getCurrentOnboardingExperience({
    supabase,
    userId: auth.userId,
    repoFullName,
    assigneeUserId: auth.userId,
    githubLogin: null,
  });

  return {
    repo_full_name: repoFullName,
    ...experience,
  };
}

async function rerunRepoChecks(
  supabase: SupabaseClient,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const repoFullName = resolveRequiredRepoFullName(auth, args);
  const checkTypes = parseStringArray(args.check_types).filter((checkType) =>
    REPO_CHECK_TYPES.includes(checkType as (typeof REPO_CHECK_TYPES)[number])
  );

  return {
    repo_full_name: repoFullName,
    ...(await runRepoChecks({
      supabase,
      userId: auth.userId,
      repoFullName,
      apiKey: auth.googleAiKey,
      triggerMode: "mcp",
      requestedCheckTypes: checkTypes,
    })),
  };
}

function buildRepoResourceUri(repoFullName: string, section: string) {
  return `kontext://repo/${encodeURIComponent(repoFullName)}/${section}`;
}

async function listResources(
  supabase: SupabaseClient,
  auth: McpAuth
): Promise<McpResourceDefinition[]> {
  const repoList = await listRepos(supabase, auth, { limit: 250 });
  const resources: McpResourceDefinition[] = [
    {
      uri: REPOS_RESOURCE_URI,
      name: "repositories",
      title: "Repositories",
      description: "Repository cards and indexing metadata from the dashboard.",
      mimeType: JSON_MIME_TYPE,
    },
    {
      uri: ACTIVITY_RESOURCE_URI,
      name: "activity-feed",
      title: "Activity Feed",
      description: "Recent dashboard activity after the user's current filters.",
      mimeType: JSON_MIME_TYPE,
    },
  ];

  for (const repo of repoList.repos) {
    resources.push(
      {
        uri: buildRepoResourceUri(repo.full_name, "overview"),
        name: `${repo.full_name} overview`,
        title: "Repo Overview",
        description: "Overview cards, recent checks, sync state, and commits.",
        mimeType: JSON_MIME_TYPE,
      },
      {
        uri: buildRepoResourceUri(repo.full_name, "graph"),
        name: `${repo.full_name} graph`,
        title: "Architecture Graph",
        description: "Dependency graph plus architecture analysis metadata.",
        mimeType: JSON_MIME_TYPE,
      },
      {
        uri: buildRepoResourceUri(repo.full_name, "timeline"),
        name: `${repo.full_name} timeline`,
        title: "Timeline",
        description: "Grouped commit timeline with sync stats.",
        mimeType: JSON_MIME_TYPE,
      },
      {
        uri: buildRepoResourceUri(repo.full_name, "activity"),
        name: `${repo.full_name} activity`,
        title: "Repo Activity",
        description: "Recent activity events for this repository.",
        mimeType: JSON_MIME_TYPE,
      },
      {
        uri: buildRepoResourceUri(repo.full_name, "checks-summary"),
        name: `${repo.full_name} checks summary`,
        title: "Checks Summary",
        description: "Latest repo-health summary.",
        mimeType: JSON_MIME_TYPE,
      },
      {
        uri: buildRepoResourceUri(repo.full_name, "checks-findings"),
        name: `${repo.full_name} findings`,
        title: "Open Findings",
        description: "Current automated findings for this repository.",
        mimeType: JSON_MIME_TYPE,
      },
      {
        uri: buildRepoResourceUri(repo.full_name, "checks-runs"),
        name: `${repo.full_name} check runs`,
        title: "Recent Check Runs",
        description: "Recent repo-health runs for this repository.",
        mimeType: JSON_MIME_TYPE,
      },
      {
        uri: buildRepoResourceUri(repo.full_name, "sync"),
        name: `${repo.full_name} sync`,
        title: "Sync Status",
        description: "Current sync status and latest background sync job.",
        mimeType: JSON_MIME_TYPE,
      },
      {
        uri: buildRepoResourceUri(repo.full_name, "team"),
        name: `${repo.full_name} team`,
        title: "Team Workspace",
        description: "Team members, invites, and onboarding manager data.",
        mimeType: JSON_MIME_TYPE,
      },
      {
        uri: buildRepoResourceUri(repo.full_name, "onboarding"),
        name: `${repo.full_name} onboarding`,
        title: "My Onboarding",
        description: "Current user's onboarding experience or preview.",
        mimeType: JSON_MIME_TYPE,
      }
    );
  }

  return resources;
}

export function parseKontextResourceUri(uri: string): ParsedKontextResourceUri {
  const parsed = new URL(uri);

  if (parsed.protocol !== "kontext:") {
    throw new ApiError(400, "INVALID_RESOURCE_URI", "Unsupported resource URI.");
  }

  const pathSegments = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  if (parsed.hostname === "dashboard" && pathSegments[0] === "repos") {
    return { kind: "dashboard-repos" };
  }

  if (parsed.hostname === "dashboard" && pathSegments[0] === "activity") {
    return { kind: "dashboard-activity" };
  }

  if (parsed.hostname === "repo" && pathSegments.length >= 2) {
    const [repoFullName, section] = pathSegments;

    switch (section) {
      case "overview":
        return { kind: "repo-overview", repoFullName };
      case "graph":
        return { kind: "repo-graph", repoFullName };
      case "timeline":
        return { kind: "repo-timeline", repoFullName };
      case "activity":
        return { kind: "repo-activity", repoFullName };
      case "checks-summary":
        return { kind: "repo-check-summary", repoFullName };
      case "checks-findings":
        return { kind: "repo-check-findings", repoFullName };
      case "checks-runs":
        return { kind: "repo-check-runs", repoFullName };
      case "sync":
        return { kind: "repo-sync", repoFullName };
      case "team":
        return { kind: "repo-team", repoFullName };
      case "onboarding":
        return { kind: "repo-onboarding", repoFullName };
      default:
        break;
    }
  }

  throw new ApiError(404, "RESOURCE_NOT_FOUND", "Resource not found.");
}

async function readResource(
  supabase: SupabaseClient,
  auth: McpAuth,
  uri: string
) {
  const parsed = parseKontextResourceUri(uri);

  let payload: unknown;
  switch (parsed.kind) {
    case "dashboard-repos":
      payload = await listRepos(supabase, auth, { limit: 250 });
      break;
    case "dashboard-activity":
      payload = await getRecentActivity(supabase, auth, { limit: 50 });
      break;
    case "repo-overview":
      payload = await getRepositoryOverview(supabase, auth, {
        repo_full_name: parsed.repoFullName,
      });
      break;
    case "repo-graph":
      payload = await getRepositoryGraph(supabase, auth, {
        repo_full_name: parsed.repoFullName,
      });
      break;
    case "repo-timeline":
      payload = await getRepositoryTimeline(supabase, auth, {
        repo_full_name: parsed.repoFullName,
        limit: 100,
      });
      break;
    case "repo-activity":
      payload = await getRecentActivity(supabase, auth, {
        repo_full_name: parsed.repoFullName,
        limit: 50,
      });
      break;
    case "repo-check-summary":
      payload = await getRepositoryHealth(supabase, auth, {
        repo_full_name: parsed.repoFullName,
      });
      break;
    case "repo-check-findings":
      payload = await listRepoFindings(supabase, auth, {
        repo_full_name: parsed.repoFullName,
        status: "open",
        limit: 100,
      });
      break;
    case "repo-check-runs":
      payload = await listCheckRuns(supabase, auth, {
        repo_full_name: parsed.repoFullName,
        limit: 50,
      });
      break;
    case "repo-sync":
      payload = await getSyncStatus(supabase, auth, {
        repo_full_name: parsed.repoFullName,
      });
      break;
    case "repo-team":
      payload = await getTeamWorkspace(supabase, auth, {
        repo_full_name: parsed.repoFullName,
      });
      break;
    case "repo-onboarding":
      payload = await getOnboardingExperience(supabase, auth, {
        repo_full_name: parsed.repoFullName,
      });
      break;
  }

  return {
    contents: [
      {
        uri,
        mimeType: JSON_MIME_TYPE,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

const REPO_ARG = {
  repo_full_name: {
    type: "string",
    description:
      "Repository full name, like owner/name. Optional when the MCP key is repo-scoped.",
  },
};

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: "list_repos",
    title: "List Repositories",
    description:
      "List the repositories available to this MCP key with indexing and sync metadata.",
    inputSchema: {
      type: "object",
      properties: {
        ...REPO_ARG,
        limit: { type: "number", description: "Max repos to return (default: 100)." },
      },
    },
  },
  {
    name: "get_repo_overview",
    title: "Get Repo Overview",
    description:
      "Fetch the high-level repo state shown in the UI overview.",
    inputSchema: {
      type: "object",
      properties: { ...REPO_ARG },
      required: ["repo_full_name"],
    },
  },
  {
    name: "search_code",
    title: "Search Indexed Code",
    description:
      "Run semantic search over indexed code and return grounded code snippets with line ranges.",
    inputSchema: {
      type: "object",
      properties: {
        ...REPO_ARG,
        query: { type: "string", description: "Search query." },
        max_results: { type: "number", description: "Max results (default: 5)." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_file",
    title: "Get Indexed File",
    description:
      "Reconstruct a file from indexed chunks and return its content plus source metadata.",
    inputSchema: {
      type: "object",
      properties: {
        ...REPO_ARG,
        path: { type: "string", description: "Relative file path." },
      },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    title: "List Indexed Files",
    description:
      "List indexed files for one repository or across all accessible repositories.",
    inputSchema: {
      type: "object",
      properties: {
        ...REPO_ARG,
        pattern: { type: "string", description: "Glob-like file pattern." },
        limit: { type: "number", description: "Max files to return (default: 200)." },
      },
    },
  },
  {
    name: "ask_question",
    title: "Ask Repo Question",
    description:
      "Ask a grounded natural-language question over the indexed repository context.",
    inputSchema: {
      type: "object",
      properties: {
        ...REPO_ARG,
        question: { type: "string", description: "Question to answer." },
      },
      required: ["question"],
    },
  },
  {
    name: "get_repo_graph",
    title: "Get Repo Graph",
    description:
      "Return the dependency graph and architecture analysis bundle used by the graph UI.",
    inputSchema: {
      type: "object",
      properties: { ...REPO_ARG },
      required: ["repo_full_name"],
    },
  },
  {
    name: "get_sync_status",
    title: "Get Sync Status",
    description:
      "Return current sync state, latest background sync job, and live upstream commit status when available.",
    inputSchema: {
      type: "object",
      properties: { ...REPO_ARG },
      required: ["repo_full_name"],
    },
  },
  {
    name: "get_timeline",
    title: "Get Timeline",
    description:
      "Return the grouped commit timeline, pagination, and sync stats used by the timeline UI.",
    inputSchema: {
      type: "object",
      properties: {
        ...REPO_ARG,
        limit: { type: "number", description: "Max commits to page in (default: 50)." },
        offset: { type: "number", description: "Pagination offset (default: 0)." },
      },
      required: ["repo_full_name"],
    },
  },
  {
    name: "get_recent_activity",
    title: "Get Recent Activity",
    description:
      "Return recent activity feed items, respecting the user's saved activity filters by default.",
    inputSchema: {
      type: "object",
      properties: {
        ...REPO_ARG,
        limit: { type: "number", description: "Max events to return (default: 20)." },
        event_types: {
          type: "array",
          items: { type: "string" },
          description: "Optional event type filter.",
        },
      },
    },
  },
  {
    name: "get_repo_health",
    title: "Get Repo Health",
    description:
      "Return the latest repo-health summary, including freshness against the current synced head.",
    inputSchema: {
      type: "object",
      properties: { ...REPO_ARG },
      required: ["repo_full_name"],
    },
  },
  {
    name: "list_findings",
    title: "List Findings",
    description:
      "List automated repo-health findings with filters for status, lane, and dismissal state.",
    inputSchema: {
      type: "object",
      properties: {
        ...REPO_ARG,
        status: { type: "string", description: "open or resolved." },
        check_type: {
          type: "string",
          description:
            "security, optimization, consistency, or change_impact.",
        },
        include_dismissed: {
          type: "boolean",
          description: "Include dismissed findings.",
        },
        limit: { type: "number", description: "Max findings to return (default: 20)." },
      },
    },
  },
  {
    name: "get_finding",
    title: "Get Finding",
    description: "Get the full details of a single automated finding by id.",
    inputSchema: {
      type: "object",
      properties: {
        finding_id: { type: "number", description: "Finding id." },
      },
      required: ["finding_id"],
    },
  },
  {
    name: "list_check_runs",
    title: "List Check Runs",
    description: "List recent repo-health runs for one repo or across all repos.",
    inputSchema: {
      type: "object",
      properties: {
        ...REPO_ARG,
        limit: { type: "number", description: "Max runs to return (default: 20)." },
      },
    },
  },
  {
    name: "list_check_configs",
    title: "List Check Configs",
    description: "Return repo-health automation settings for the repository.",
    inputSchema: {
      type: "object",
      properties: { ...REPO_ARG },
      required: ["repo_full_name"],
    },
  },
  {
    name: "get_team_workspace",
    title: "Get Team Workspace",
    description:
      "Return team members, pending invites, onboarding templates, and assignment summaries for the repository.",
    inputSchema: {
      type: "object",
      properties: { ...REPO_ARG },
      required: ["repo_full_name"],
    },
  },
  {
    name: "get_onboarding_experience",
    title: "Get Onboarding Experience",
    description:
      "Return the current user's onboarding assignment or preview experience for the repository.",
    inputSchema: {
      type: "object",
      properties: { ...REPO_ARG },
      required: ["repo_full_name"],
    },
  },
  {
    name: "rerun_checks",
    title: "Rerun Checks",
    description:
      "Ask Kontext to rerun automated repo-health checks for the repository.",
    inputSchema: {
      type: "object",
      properties: {
        ...REPO_ARG,
        check_types: {
          type: "array",
          items: { type: "string" },
          description: "Optional subset of lanes to rerun.",
        },
      },
      required: ["repo_full_name"],
    },
  },
];

export const MCP_PROMPT_DEFINITIONS: McpPromptDefinition[] = [
  {
    name: "repo_overview",
    title: "Repository Overview",
    description:
      "Prompt template for summarizing a repository's current state from the MCP tools.",
    arguments: [
      {
        name: "repo_full_name",
        description: "Repository full name like owner/name.",
        required: true,
      },
    ],
  },
  {
    name: "triage_findings",
    title: "Triage Findings",
    description:
      "Prompt template for investigating open repo-health findings and prioritizing fixes.",
    arguments: [
      {
        name: "repo_full_name",
        description: "Repository full name like owner/name.",
        required: true,
      },
    ],
  },
  {
    name: "team_onboarding",
    title: "Team Onboarding",
    description:
      "Prompt template for summarizing team membership and onboarding state for a repository.",
    arguments: [
      {
        name: "repo_full_name",
        description: "Repository full name like owner/name.",
        required: true,
      },
    ],
  },
];

function buildPromptMessages(name: string, args: Record<string, unknown>) {
  const repoFullName = normalizeRepoFullName(args.repo_full_name);

  if (!repoFullName) {
    throw new ApiError(
      400,
      "REPO_SCOPE_REQUIRED",
      "repo_full_name is required for this prompt."
    );
  }

  switch (name) {
    case "repo_overview":
      return {
        description:
          "Summarize the current repository state using the overview, sync, health, and activity tools.",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Summarize the current state of ${repoFullName}. Use get_repo_overview, get_sync_status, get_repo_health, and get_recent_activity as needed. Highlight sync blockers, stale checks, and the most important recent changes.`,
            },
          },
        ],
      };
    case "triage_findings":
      return {
        description:
          "Investigate and prioritize the repository's open findings.",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Review the current open findings for ${repoFullName}. Use list_findings, get_finding, get_file, and get_repo_health to identify which issues matter most, what evidence supports them, and what fix order makes sense.`,
            },
          },
        ],
      };
    case "team_onboarding":
      return {
        description:
          "Summarize team membership, pending invites, and onboarding progress.",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Summarize the team and onboarding state for ${repoFullName}. Use get_team_workspace and get_onboarding_experience. Call out pending invites, assignment progress, the current published template, and any obvious onboarding gaps.`,
            },
          },
        ],
      };
    default:
      throw new ApiError(404, "PROMPT_NOT_FOUND", "Prompt not found.");
  }
}

export async function handleMcpRequest(
  auth: McpAuth,
  body: JsonRpcRequestBody
) {
  const method = typeof body.method === "string" ? body.method : "";
  const id = body.id ?? null;
  const params =
    body.params && typeof body.params === "object" ? body.params : {};
  const supabase = getAdminDb();

  if (!method) {
    return buildJsonRpcError(
      id,
      new ApiError(400, "METHOD_REQUIRED", "method is required.")
    );
  }

  if (method === "ping") {
    return buildJsonRpcResult(id, {});
  }

  if (method === "initialize") {
    return buildJsonRpcResult(id, {
      protocolVersion: "2024-11-05",
      serverInfo: MCP_SERVER_INFO,
      capabilities: MCP_SERVER_CAPABILITIES,
    });
  }

  if (method.startsWith("notifications/")) {
    return null;
  }

  if (method === "tools/list") {
    return buildJsonRpcResult(id, {
      tools: MCP_TOOL_DEFINITIONS,
    });
  }

  if (method === "resources/list") {
    return buildJsonRpcResult(id, {
      resources: await listResources(supabase, auth),
    });
  }

  if (method === "resources/read") {
    const uri = typeof params.uri === "string" ? params.uri : "";
    if (!uri) {
      return buildJsonRpcError(
        id,
        new ApiError(400, "RESOURCE_URI_REQUIRED", "uri is required.")
      );
    }

    try {
      return buildJsonRpcResult(id, await readResource(supabase, auth, uri));
    } catch (error: unknown) {
      return buildJsonRpcError(id, error);
    }
  }

  if (method === "prompts/list") {
    return buildJsonRpcResult(id, {
      prompts: MCP_PROMPT_DEFINITIONS,
    });
  }

  if (method === "prompts/get") {
    const name = typeof params.name === "string" ? params.name : "";
    const promptArgs =
      params.arguments && typeof params.arguments === "object"
        ? (params.arguments as Record<string, unknown>)
        : {};

    try {
      return buildJsonRpcResult(id, buildPromptMessages(name, promptArgs));
    } catch (error: unknown) {
      return buildJsonRpcError(id, error);
    }
  }

  if (method !== "tools/call") {
    return {
      jsonrpc: "2.0" as const,
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    };
  }

  const toolName = typeof params.name === "string" ? params.name : "";
  const args =
    params.arguments && typeof params.arguments === "object"
      ? (params.arguments as Record<string, unknown>)
      : {};

  if (!toolName) {
    return buildJsonRpcError(
      id,
      new ApiError(400, "TOOL_NAME_REQUIRED", "Tool name is required.")
    );
  }

  try {
    const rl = rateLimit(auth.userId, "mcp");
    if (!rl.ok) {
      throw new ApiError(429, "RATE_LIMITED", "Rate limited.");
    }

    let result: unknown;
    switch (toolName) {
      case "list_repos":
        result = await listRepos(supabase, auth, args);
        break;
      case "get_repo_overview":
        result = await getRepositoryOverview(supabase, auth, args);
        break;
      case "search_code":
        result = await searchIndexedCode(supabase, auth, args);
        break;
      case "get_file":
        result = await getIndexedFile(supabase, auth, args);
        break;
      case "list_files":
        result = await listIndexedFiles(supabase, auth, args);
        break;
      case "ask_question":
        result = await askRepositoryQuestion(supabase, auth, args);
        break;
      case "get_repo_graph":
        result = await getRepositoryGraph(supabase, auth, args);
        break;
      case "get_sync_status":
        result = await getSyncStatus(supabase, auth, args);
        break;
      case "get_timeline":
        result = await getRepositoryTimeline(supabase, auth, args);
        break;
      case "get_recent_activity":
        result = await getRecentActivity(supabase, auth, args);
        break;
      case "get_repo_health":
        result = await getRepositoryHealth(supabase, auth, args);
        break;
      case "list_findings":
        result = await listRepoFindings(supabase, auth, args);
        break;
      case "get_finding":
        result = await getFindingById(supabase, auth, args);
        break;
      case "list_check_runs":
        result = await listCheckRuns(supabase, auth, args);
        break;
      case "list_check_configs":
        result = await listCheckConfigs(supabase, auth, args);
        break;
      case "get_team_workspace":
        result = await getTeamWorkspace(supabase, auth, args);
        break;
      case "get_onboarding_experience":
        result = await getOnboardingExperience(supabase, auth, args);
        break;
      case "rerun_checks":
        result = await rerunRepoChecks(supabase, auth, args);
        break;
      default:
        throw new ApiError(400, "UNKNOWN_TOOL", `Unknown tool: ${toolName}`);
    }

    return buildJsonRpcResult(id, buildToolResultPayload(result));
  } catch (error: unknown) {
    return buildJsonRpcError(id, error);
  }
}
