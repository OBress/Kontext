import { NextResponse } from "next/server";

// Mock streaming chat response
export async function POST(request: Request) {
  const body = await request.json();
  const question = body.message || "How does this code work?";

  const mockSources = [
    { file_path: "lib/auth.ts", content: "export async function getSession() {\n  const token = cookies().get('token');\n  return validateToken(token);\n}", similarity: 0.94, line_start: 12, line_end: 15 },
    { file_path: "components/Header.tsx", content: "const { user } = useAuth();\nreturn <nav>{user ? <Avatar /> : <LoginButton />}</nav>;", similarity: 0.87, line_start: 8, line_end: 10 },
    { file_path: "lib/db.ts", content: "export const db = new PrismaClient();\nexport async function getUser(id: string) {\n  return db.user.findUnique({ where: { id } });\n}", similarity: 0.82, line_start: 1, line_end: 4 },
  ];

  const responseText = `Based on the codebase analysis, here's how the authentication system works:

## Authentication Flow

The auth system is built around \`lib/auth.ts\` which provides session management:

1. **Session Validation** — The \`getSession()\` function reads the token from cookies and validates it against the database.

2. **Component Integration** — The \`Header\` component uses the \`useAuth()\` hook to conditionally render user-specific UI:

\`\`\`typescript
const { user } = useAuth();
return <nav>{user ? <Avatar /> : <LoginButton />}</nav>;
\`\`\`

3. **Database Layer** — User data is stored via Prisma ORM in \`lib/db.ts\`, with type-safe queries.

### Key Files
- \`lib/auth.ts\` — Core authentication logic
- \`lib/db.ts\` — Database client and queries
- \`components/Header.tsx\` — Auth-aware navigation

The pattern follows a **cookie-based session** approach rather than JWT tokens, which is more secure for server-rendered pages.`;

  // Stream the response character by character
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Send sources first
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "sources", sources: mockSources })}\n\n`)
      );

      // Stream text in chunks
      const chunkSize = 8;
      for (let i = 0; i < responseText.length; i += chunkSize) {
        const chunk = responseText.slice(i, i + chunkSize);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "text", content: chunk })}\n\n`)
        );
        await new Promise((r) => setTimeout(r, 20));
      }

      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
      controller.close();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
