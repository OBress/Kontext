import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hashApiKey } from "@/lib/api/crypto";

/**
 * Validate an MCP API key from the Authorization header.
 * Returns the user_id and optional repo scope.
 */
async function validateMcpAuth(
  request: Request
): Promise<{ userId: string; repoFullName: string | null } | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer kt_")) return null;

  const rawKey = authHeader.slice(7); // Remove "Bearer "
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

  // Update last_used_at
  await adminDb
    .from("mcp_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("key_hash", keyHash);

  return { userId: keyRow.user_id, repoFullName: keyRow.repo_full_name };
}

/**
 * GET /api/mcp/sse — MCP Server SSE endpoint
 *
 * Implements a simplified MCP-compatible SSE transport.
 * External AI agents connect here and send tool calls via /api/mcp/messages.
 */
export async function GET(request: Request) {
  const auth = await validateMcpAuth(request);
  if (!auth) {
    return NextResponse.json(
      { error: "Invalid or missing MCP API key" },
      { status: 401 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send MCP server capabilities
      const capabilities = {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {
          serverInfo: {
            name: "kontext-mcp",
            version: "1.0.0",
          },
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
        },
      };

      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(capabilities)}\n\n`)
      );

      // Send tool list
      const tools = {
        jsonrpc: "2.0",
        method: "notifications/tools/list",
        params: {
          tools: [
            {
              name: "search_code",
              description: "Semantic search across the indexed codebase using vector similarity",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Search query" },
                  max_results: { type: "number", description: "Max results (default: 5)" },
                },
                required: ["query"],
              },
            },
            {
              name: "get_file",
              description: "Retrieve the full content of a specific file from the repository",
              inputSchema: {
                type: "object",
                properties: {
                  path: { type: "string", description: "Relative file path" },
                },
                required: ["path"],
              },
            },
            {
              name: "list_files",
              description: "List all files in the repository matching an optional pattern",
              inputSchema: {
                type: "object",
                properties: {
                  pattern: { type: "string", description: "Glob pattern (default: all)" },
                },
              },
            },
            {
              name: "ask_question",
              description: "Ask a natural language question about the codebase with RAG context",
              inputSchema: {
                type: "object",
                properties: {
                  question: { type: "string", description: "Question to ask" },
                },
                required: ["question"],
              },
            },
            {
              name: "get_repo_health",
              description: "Get the latest repo health summary, including open findings and the latest automated check run",
              inputSchema: {
                type: "object",
                properties: {
                  repo_full_name: { type: "string", description: "Optional when the MCP key is already scoped to a repository" },
                },
              },
            },
            {
              name: "list_findings",
              description: "List current repo findings from Kontext automated checks",
              inputSchema: {
                type: "object",
                properties: {
                  repo_full_name: { type: "string", description: "Optional when the MCP key is already scoped to a repository" },
                  status: { type: "string", description: "open or resolved" },
                  check_type: { type: "string", description: "security, optimization, consistency, or change_impact" },
                  limit: { type: "number", description: "Max findings to return (default: 20)" },
                },
              },
            },
            {
              name: "get_finding",
              description: "Get the full details of a specific Kontext finding by id",
              inputSchema: {
                type: "object",
                properties: {
                  finding_id: { type: "number", description: "The numeric finding id" },
                },
                required: ["finding_id"],
              },
            },
            {
              name: "rerun_checks",
              description: "Ask Kontext to rerun automated checks for the scoped repository",
              inputSchema: {
                type: "object",
                properties: {
                  repo_full_name: { type: "string", description: "Optional when the MCP key is already scoped to a repository" },
                  check_types: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional subset of check types to run",
                  },
                },
              },
            },
          ],
        },
      };

      controller.enqueue(encoder.encode(`data: ${JSON.stringify(tools)}\n\n`));

      // Keep-alive ping every 30s
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(interval);
        }
      }, 30000);

      // Clean up on abort
      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}
