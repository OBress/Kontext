import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hashApiKey } from "@/lib/api/crypto";
import { ApiError, getApiErrorPayload } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import {
  getRepoHealthSummary,
  REPO_CHECK_TYPES,
  runRepoChecks,
} from "@/lib/api/repo-checks";
import {
  answerRepoQuestion,
  retrieveRepoContext,
} from "@/lib/api/repo-intelligence";

async function validateMcpAuth(
  request: Request
): Promise<{ userId: string; repoFullName: string | null } | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer kt_")) return null;

  const rawKey = authHeader.slice(7);
  const keyHash = hashApiKey(rawKey);

  const adminDb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: keyRow } = await adminDb
    .from("mcp_api_keys")
    .select("user_id, repo_full_name")
    .eq("key_hash", keyHash)
    .single();

  if (!keyRow) return null;

  await adminDb
    .from("mcp_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("key_hash", keyHash);

  return { userId: keyRow.user_id, repoFullName: keyRow.repo_full_name };
}

function resolveScopedRepoFullName(
  auth: { repoFullName: string | null },
  args: Record<string, unknown>
) {
  const value =
    (typeof args.repo_full_name === "string" && args.repo_full_name.trim()) ||
    auth.repoFullName;

  if (!value) {
    throw new ApiError(
      400,
      "REPO_SCOPE_REQUIRED",
      "repo_full_name is required when the MCP key is not already scoped to a repository."
    );
  }

  return value;
}

/**
 * POST /api/mcp/messages - Handle MCP tool call requests
 */
export async function POST(request: Request) {
  const auth = await validateMcpAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(auth.userId, "mcp");
  if (!rl.ok) {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Rate limited" } },
      { status: 429 }
    );
  }

  const body = await request.json();

  if (body.method === "tools/call") {
    const { name, arguments: args } = body.params;
    const apiKey = request.headers.get("x-google-api-key");

    const adminDb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    try {
      let result: unknown;

      switch (name) {
        case "search_code": {
          if (!apiKey) {
            throw new ApiError(
              400,
              "API_KEY_REQUIRED",
              "x-google-api-key header required for search_code"
            );
          }

          const context = await retrieveRepoContext({
            supabase: adminDb,
            userId: auth.userId,
            repoFullName: auth.repoFullName,
            query: args.query,
            apiKey,
            includeTimeline: false,
            matchCount: args.max_results || 5,
          });

          result = context.citations.slice(0, args.max_results || 5);
          break;
        }

        case "get_file": {
          const { data } = await adminDb
            .from("repo_chunks")
            .select("content, file_path, chunk_index")
            .eq("user_id", auth.userId)
            .eq("file_path", args.path)
            .order("chunk_index", { ascending: true });

          if (!data || data.length === 0) {
            result = { error: "File not found in index" };
          } else {
            result = {
              file_path: args.path,
              content: data.map((chunk) => chunk.content).join("\n"),
              chunks: data.length,
            };
          }
          break;
        }

        case "list_files": {
          let query = adminDb
            .from("repo_files")
            .select("file_path, extension, line_count")
            .eq("user_id", auth.userId);

          if (auth.repoFullName) {
            query = query.eq("repo_full_name", auth.repoFullName);
          }

          if (args.pattern) {
            const likePattern = args.pattern
              .replace(/\*/g, "%")
              .replace(/\?/g, "_");
            query = query.like("file_path", likePattern);
          }

          const { data } = await query.limit(100);
          result = data || [];
          break;
        }

        case "ask_question": {
          if (!apiKey) {
            throw new ApiError(
              400,
              "API_KEY_REQUIRED",
              "x-google-api-key header required for ask_question"
            );
          }

          const context = await retrieveRepoContext({
            supabase: adminDb,
            userId: auth.userId,
            repoFullName: auth.repoFullName,
            query: args.question,
            apiKey,
            includeTimeline: true,
            matchCount: 12,
          });

          const hasContext =
            context.dedupedCitations.length > 0 ||
            context.hasSupplementalContext;

          const answer = !hasContext
            ? "Insufficient evidence from the indexed repository."
            : await answerRepoQuestion({
                apiKey,
                repoFullName: context.repoLabel,
                question: args.question,
                fileManifest: context.fileManifest,
                contextBlocks: context.contextBlocks,
                timelineBlocks: context.timelineBlocks,
                recentCommitsBlock: context.recentCommitsBlock || undefined,
                architectureBlock: context.architectureBlock || undefined,
                healthFindingsBlock:
                  context.healthFindingsBlock || undefined,
                activityBlock: context.activityBlock || undefined,
                repoMetadataBlock: context.repoMetadataBlock || undefined,
              });

          result = {
            answer,
            sources: context.dedupedCitations,
            timeline: context.timelineCitations,
            answerMode: context.answerMode,
          };
          break;
        }

        case "get_repo_health": {
          const repoFullName = resolveScopedRepoFullName(auth, args);
          result = await getRepoHealthSummary(adminDb, auth.userId, repoFullName);
          break;
        }

        case "list_findings": {
          let query = adminDb
            .from("repo_check_findings")
            .select("*")
            .eq("user_id", auth.userId)
            .order("updated_at", { ascending: false });

          if (auth.repoFullName || typeof args.repo_full_name === "string") {
            query = query.eq(
              "repo_full_name",
              resolveScopedRepoFullName(auth, args)
            );
          }

          if (args.status === "open" || args.status === "resolved") {
            query = query.eq("status", args.status);
          }

          if (
            typeof args.check_type === "string" &&
            REPO_CHECK_TYPES.includes(args.check_type as (typeof REPO_CHECK_TYPES)[number])
          ) {
            query = query.eq("check_type", args.check_type);
          }

          const limit =
            typeof args.limit === "number" && Number.isFinite(args.limit)
              ? Math.min(Math.max(Math.trunc(args.limit), 1), 50)
              : 20;

          const { data } = await query.limit(limit);
          result = data || [];
          break;
        }

        case "get_finding": {
          const findingId =
            typeof args.finding_id === "number" ? Math.trunc(args.finding_id) : 0;
          if (!findingId) {
            throw new ApiError(400, "FINDING_ID_REQUIRED", "finding_id is required.");
          }

          const { data } = await adminDb
            .from("repo_check_findings")
            .select("*")
            .eq("user_id", auth.userId)
            .eq("id", findingId)
            .maybeSingle();

          result = data || { error: "Finding not found" };
          break;
        }

        case "rerun_checks": {
          const repoFullName = resolveScopedRepoFullName(auth, args);
          const apiKey = request.headers.get("x-google-api-key");
          const checkTypes = Array.isArray(args.check_types) ? args.check_types : [];

          result = await runRepoChecks({
            userId: auth.userId,
            repoFullName,
            apiKey,
            triggerMode: "mcp",
            requestedCheckTypes: checkTypes,
          });
          break;
        }

        default:
          return NextResponse.json({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32601, message: `Unknown tool: ${name}` },
          });
      }

      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    } catch (err: unknown) {
      const payload = getApiErrorPayload(err);
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        error: {
          code: payload.code.startsWith("AI_") ? -32001 : -32000,
          message: payload.message,
          data: payload,
        },
      });
    }
  }

  if (body.method === "tools/list") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        tools: [
          { name: "search_code", description: "Semantic code search", inputSchema: { type: "object", properties: { query: { type: "string" }, max_results: { type: "number" } }, required: ["query"] } },
          { name: "get_file", description: "Get file content", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
          { name: "list_files", description: "List repository files", inputSchema: { type: "object", properties: { pattern: { type: "string" } } } },
          { name: "ask_question", description: "Ask about the codebase", inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
          { name: "get_repo_health", description: "Get repo health summary", inputSchema: { type: "object", properties: { repo_full_name: { type: "string" } } } },
          { name: "list_findings", description: "List Kontext findings", inputSchema: { type: "object", properties: { repo_full_name: { type: "string" }, status: { type: "string" }, check_type: { type: "string" }, limit: { type: "number" } } } },
          { name: "get_finding", description: "Get a finding by id", inputSchema: { type: "object", properties: { finding_id: { type: "number" } }, required: ["finding_id"] } },
          { name: "rerun_checks", description: "Rerun Kontext checks", inputSchema: { type: "object", properties: { repo_full_name: { type: "string" }, check_types: { type: "array", items: { type: "string" } } } } },
        ],
      },
    });
  }

  return NextResponse.json({
    jsonrpc: "2.0",
    id: body.id,
    error: { code: -32601, message: `Method not found: ${body.method}` },
  });
}
