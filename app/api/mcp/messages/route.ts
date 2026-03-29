import { NextResponse } from "next/server";
import { MCP_CORS_HEADERS, handleMcpRequest } from "@/lib/mcp/server";
import {
  deleteMcpSession,
  getMcpSession,
  sendJsonRpcResponse,
} from "@/lib/mcp/sessions";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: MCP_CORS_HEADERS,
  });
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing sessionId query parameter" },
      { status: 400, headers: MCP_CORS_HEADERS }
    );
  }

  const session = getMcpSession(sessionId);
  if (!session) {
    return NextResponse.json(
      { error: "Session not found or expired. Reconnect to /api/mcp/sse." },
      { status: 404, headers: MCP_CORS_HEADERS }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: MCP_CORS_HEADERS }
    );
  }

  const responsePayload = await handleMcpRequest(
    {
      keyHash: "session",
      userId: session.userId,
      repoFullName: session.repoFullName,
      googleAiKey: session.googleAiKey,
    },
    body
  );

  if (responsePayload !== null) {
    sendJsonRpcResponse(session, responsePayload);
  }

  return new NextResponse(null, {
    status: 202,
    headers: MCP_CORS_HEADERS,
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing sessionId query parameter" },
      { status: 400, headers: MCP_CORS_HEADERS }
    );
  }

  deleteMcpSession(sessionId);
  return new NextResponse(null, {
    status: 204,
    headers: MCP_CORS_HEADERS,
  });
}
