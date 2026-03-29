# Project Overview

Kontext is a developer-centric repository intelligence platform. It provides AI-powered code analysis, dependency graphing, and repository synchronization. It uses a Next.js 16 App Router architecture, Supabase for persistence, and Gemini for LLM-driven insights.

## Tech Stack

- **Runtime**: Node.js 20+.
- **Framework**: Next.js 16 (App Router).
- **Language**: TypeScript 5 (Strict Mode enabled).
- **Styling**: Tailwind CSS v4 (using `@tailwindcss/postcss`).
- **Database**: Supabase (PostgreSQL with RLS).
- **AI/ML**: Google Gemini (via `@google/generative-ai`), embedding generation, and custom chunking.
- **State Management**: Zustand v5.
- **UI Foundation**: React 19, Radix UI (shadcn/ui style components).
- **3D/Visualization**: Three.js, React Three Fiber, React-force-graph-3d.
- **Utilities**: Framer Motion (animations), Zod (via validation patterns), Lucide React (icons).
- **Deployment**: Railway.

## Directory Structure

- `/app`: Next.js App Router pages and API routes.
- `/components`: Reusable UI primitives.
- `/lib`: Business logic, AI orchestrators, database clients, and utilities.
- `/supabase`: SQL migrations and configuration.
- `/types`: Shared TypeScript definitions.

## Commands

- `npm run dev`: Start local development.
- `npm run build`: Production build.
- `npm run lint`: Run ESLint.
- `npm run db:push`: Sync local changes to Supabase.
- `npm run db:types`: Generate TypeScript types from schema.

## Coding Standards

- **Naming**: PascalCase for components, camelCase for variables/functions. Filenames: kebab-case.
- **Imports**: Use `@/*` alias for imports within the project. Keep imports organized: 1) Node modules 2) Internal Libs 3) Components 4) Relative paths.
- **Strictness**: No `any`. Use `unknown` with manual type guards. Avoid default exports where named exports improve clarity.
- **Error Handling**: Use `lib/api/errors.ts` for consistent `ApiError` instantiation and `handleApiError` for responses.

## Security

- **Secrets**: Use `process.env`. Never commit `.env` files. Use `lib/api/crypto.ts` for sensitive data storage (encryption).
- **Validation**: Every public API route must use Zod or custom validator functions (see `lib/api/validate.ts`).
- **RLS**: Database operations must be performed via Supabase client with RLS enabled.

## Git Workflow

- Commit messages: Follow conventional commits.
- PRs: Ensure all CI checks pass (lint, build, types).

## Definition of Done

- Feature is implemented with type safety.
- Error handling follows `lib/api/errors.ts` pattern.
- No `any` types used.
- Responsive styles verified (Tailwind).
- Code is co-located with tests/docs where appropriate.
