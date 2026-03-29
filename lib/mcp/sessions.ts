/**
 * In-memory MCP session store for the legacy SSE transport.
 *
 * Streamable HTTP requests can be handled statelessly, but older SSE clients
 * expect the server to hand back a follow-up endpoint. We keep a small
 * expiring session map for that endpoint so responses can be pushed back onto
 * the right event stream.
 */

const SESSION_TTL_MS = 30 * 60_000;
const CLEANUP_INTERVAL_MS = 5 * 60_000;

export interface McpSession {
  enqueue: (chunk: string) => void;
  userId: string;
  repoFullName: string | null;
  googleAiKey: string | null;
  createdAt: number;
  lastSeenAt: number;
}

export const mcpSessions = new Map<string, McpSession>();

const cleanupHandle = setInterval(() => {
  const now = Date.now();

  for (const [sessionId, session] of mcpSessions.entries()) {
    if (now - session.lastSeenAt > SESSION_TTL_MS) {
      mcpSessions.delete(sessionId);
    }
  }
}, CLEANUP_INTERVAL_MS);

if (typeof cleanupHandle.unref === "function") {
  cleanupHandle.unref();
}

export function createMcpSession(
  sessionId: string,
  session: Omit<McpSession, "createdAt" | "lastSeenAt">
) {
  const now = Date.now();
  const nextSession: McpSession = {
    ...session,
    createdAt: now,
    lastSeenAt: now,
  };

  mcpSessions.set(sessionId, nextSession);
  return nextSession;
}

export function getMcpSession(sessionId: string): McpSession | null {
  const session = mcpSessions.get(sessionId);
  if (!session) return null;

  if (Date.now() - session.lastSeenAt > SESSION_TTL_MS) {
    mcpSessions.delete(sessionId);
    return null;
  }

  session.lastSeenAt = Date.now();
  return session;
}

export function deleteMcpSession(sessionId: string): boolean {
  return mcpSessions.delete(sessionId);
}

export function sendSseEvent(
  session: Pick<McpSession, "enqueue">,
  event: string,
  data: string
): void {
  session.enqueue(`event: ${event}\ndata: ${data}\n\n`);
}

export function sendJsonRpcResponse(
  session: Pick<McpSession, "enqueue">,
  payload: unknown
): void {
  sendSseEvent(session, "message", JSON.stringify(payload));
}
