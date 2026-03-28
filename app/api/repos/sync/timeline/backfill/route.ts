import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { validateRepoFullName, validateApiKey } from "@/lib/api/validate";
import { backfillMissingSummaries } from "@/lib/api/timeline-ai";
import { rateLimit } from "@/lib/api/rate-limit";

/**
 * POST /api/repos/sync/timeline/backfill
 *
 * Backfill AI summaries for commits that don't have them yet.
 * Called from the Timeline page when it detects pending summaries.
 */
export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "timeline_backfill");
    if (!rl.ok) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many backfill requests" } },
        { status: 429 }
      );
    }

    const body = await request.json();
    const repoFullName = validateRepoFullName(body.repo_full_name);
    const apiKey = validateApiKey(request);
    const limit = Math.min(Number(body.limit || 20), 50);

    const processed = await backfillMissingSummaries(
      apiKey,
      user.id,
      repoFullName,
      limit
    );

    return NextResponse.json({ processed, remaining: processed === limit });
  } catch (error) {
    return handleApiError(error);
  }
}
