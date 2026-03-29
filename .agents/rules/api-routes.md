# API Conventions

## Core Rules
- **Response Structure**: Use `NextResponse.json(...)` combined with `handleApiError` from `lib/api/errors.ts`.
- **Rate Limiting**: All primary routes MUST call `rateLimit()` from `lib/api/rate-limit` as the first step.
- **Authentication**: Use `getAuthenticatedUser()` from `lib/api/auth` to ensure user context.
- **Validation**: Use `lib/api/validate.ts` helpers. Do not parse raw `request.json()` without schema validation.

## Gold Standard
- Follow `app/api/repos/ingest/route.ts` for transactional logic.
- Follow `lib/api/errors.ts` for error mapping.

## Code Example
```typescript
import { handleApiError } from "@/lib/api/errors";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";

export async function POST(req: Request) {
  try {
    await rateLimit();
    const { user } = await getAuthenticatedUser();
    const body = await req.json();
    // Validate logic...
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
```
- **DO**: Use early returns.
- **DO**: Log significant events using `lib/api/activity.ts`.
- **DON'T**: Expose raw database errors to the client.