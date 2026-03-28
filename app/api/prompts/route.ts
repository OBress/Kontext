import { NextResponse } from "next/server";

export async function POST() {
  const mockPrompt = `# System Prompt — acme/web-platform

You are an expert developer working on the **acme/web-platform** repository. Follow these conventions precisely.

## Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript 5.x (strict mode)
- **Styling**: Tailwind CSS 3.x
- **Database**: PostgreSQL via Prisma ORM
- **Auth**: Cookie-based sessions via \`lib/auth.ts\`
- **Testing**: Jest + React Testing Library
- **Deployment**: Docker on Railway

## Coding Standards

### File Organization
- Pages go in \`app/\` using the App Router convention
- Shared components go in \`components/\`
- UI primitives go in \`components/ui/\`
- Business logic goes in \`lib/\`
- Custom hooks go in \`hooks/\`

### TypeScript
- Always use explicit return types on exported functions
- Prefer \`interface\` over \`type\` for object shapes
- Use \`const\` assertions for literal types
- Never use \`any\` — use \`unknown\` with type guards instead

### React
- Use Server Components by default
- Add \`"use client"\` only when using hooks, event handlers, or browser APIs
- Colocate component-specific types in the same file
- Use \`React.FC\` sparingly — prefer explicit props interfaces

### Styling
- Use Tailwind utilities; avoid custom CSS unless absolutely necessary
- Follow the design system tokens in \`globals.css\`
- Use \`cn()\` utility from \`lib/utils\` for conditional classes

### Error Handling
- Wrap async operations in try/catch
- Use custom error classes from \`lib/errors.ts\`
- Always return meaningful error messages to the UI

### Git
- Commit messages follow Conventional Commits
- Branch names: \`feat/\`, \`fix/\`, \`chore/\`
- PRs require at least one review
`;

  const detectedStack = [
    { name: "Next.js 14", category: "Framework", confidence: 98 },
    { name: "TypeScript", category: "Language", confidence: 100 },
    { name: "React 18", category: "Library", confidence: 100 },
    { name: "Tailwind CSS", category: "Styling", confidence: 95 },
    { name: "Prisma", category: "Database", confidence: 90 },
    { name: "PostgreSQL", category: "Database", confidence: 85 },
    { name: "Jest", category: "Testing", confidence: 80 },
    { name: "Docker", category: "DevOps", confidence: 75 },
    { name: "ESLint", category: "Tooling", confidence: 92 },
  ];

  return NextResponse.json({ prompt: mockPrompt, detectedStack });
}
