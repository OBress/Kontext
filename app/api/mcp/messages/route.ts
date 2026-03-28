import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hashApiKey } from "@/lib/api/crypto";
import { rateLimit } from "@/lib/api/rate-limit";
import { generateEmbeddings, generateText } from "@/lib/api/embeddings";

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

/**
 * POST /api/mcp/messages — Handle MCP tool call requests
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

  // Handle JSON-RPC requests
  if (body.method === "tools/call") {
    const { name, arguments: args } = body.params;
    const apiKey = request.headers.get("x-google-api-key");

    const adminDb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    try {
      let result: any;

      switch (name) {
        case "search_code": {
          if (!apiKey) {
            throw new Error("x-google-api-key header required for search_code");
          }
          const [embedding] = await generateEmbeddings(apiKey, [args.query]);
          const { data } = await adminDb.rpc("match_chunks", {
            query_embedding: JSON.stringify(embedding),
            match_count: args.max_results || 5,
            filter_repo: auth.repoFullName,
            filter_user_id: auth.userId,
          });
          result = data || [];
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
              content: data.map((c) => c.content).join("\n"),
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
            // Simple LIKE pattern matching
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
            throw new Error("x-google-api-key header required for ask_question");
          }

          const [qEmbedding] = await generateEmbeddings(apiKey, [args.question]);
          const { data: chunks } = await adminDb.rpc("match_chunks", {
            query_embedding: JSON.stringify(qEmbedding),
            match_count: 5,
            filter_repo: auth.repoFullName,
            filter_user_id: auth.userId,
          });

          const context = (chunks || [])
            .map((c: any) => `// ${c.file_path}\n${c.content}`)
            .join("\n\n");

          const answer = await generateText(
            apiKey,
            `Question: ${args.question}\n\nCode context:\n${context}`,
            "You are Kontext, an AI codebase assistant. Answer based on the provided code context."
          );

          result = { answer, sources: chunks || [] };
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
    } catch (err: any) {
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32000, message: err.message },
      });
    }
  }

  // Handle tools/list
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
