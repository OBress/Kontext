import { NextResponse } from "next/server";
import {
  MCP_CORS_HEADERS,
  handleMcpRequest,
  validateMcpAuth,
} from "@/lib/mcp/server";
import { createMcpSession, deleteMcpSession } from "@/lib/mcp/sessions";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: MCP_CORS_HEADERS,
  });
}

export async function GET(request: Request) {
  const auth = await validateMcpAuth(request);
  if (!auth) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: MCP_CORS_HEADERS }
    );
  }

  const encoder = new TextEncoder();
  const origin = new URL(request.url).origin;
  const sessionId = crypto.randomUUID();

  const stream = new ReadableStream({
    start(controller) {
      createMcpSession(sessionId, {
        enqueue(chunk) {
          controller.enqueue(encoder.encode(chunk));
        },
        userId: auth.userId,
        repoFullName: auth.repoFullName,
        googleAiKey: auth.googleAiKey,
      });

      controller.enqueue(
        encoder.encode(
          `event: endpoint\ndata: ${origin}/api/mcp/messages?sessionId=${sessionId}\n\n`
        )
      );

      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(interval);
        }
      }, 30_000);

      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        deleteMcpSession(sessionId);
        try {
          controller.close();
        } catch {
          // The stream may already be closed.
        }
      });
    },
  });

  return new NextResponse(stream, {
    headers: {
      ...MCP_CORS_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Mcp-Session-Id": sessionId,
    },
  });
}

export async function POST(request: Request) {
  const auth = await validateMcpAuth(request);
  if (!auth) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: MCP_CORS_HEADERS }
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

  const responsePayload = await handleMcpRequest(auth, body);
  if (responsePayload === null) {
    return new NextResponse(null, {
      status: 204,
      headers: MCP_CORS_HEADERS,
    });
  }

  return NextResponse.json(responsePayload, {
    headers: MCP_CORS_HEADERS,
  });
}

export async function DELETE(request: Request) {
  const auth = await validateMcpAuth(request);
  if (!auth) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: MCP_CORS_HEADERS }
    );
  }

  const { searchParams } = new URL(request.url);
  const sessionId =
    searchParams.get("sessionId") || request.headers.get("Mcp-Session-Id");

  if (sessionId) {
    deleteMcpSession(sessionId);
  }

  return new NextResponse(null, {
    status: 204,
    headers: MCP_CORS_HEADERS,
  });
}
