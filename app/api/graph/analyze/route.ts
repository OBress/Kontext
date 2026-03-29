import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { validateApiKey, validateRepoFullName } from "@/lib/api/validate";
import {
  refreshArchitectureBundle,
} from "@/lib/api/architecture-refresh";
import { getArchitectureView } from "@/types/architecture";

/**
 * POST /api/graph/analyze - Run AI architecture analysis on a repo.
 *
 * Requires: x-google-api-key header, repo_full_name in body.
 * Returns: Architecture bundle JSON, also caches in repos table.
 */
export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "graph-analyze");
    if (!rl.ok) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        { status: 429 }
      );
    }

    const body = await request.json();
    const fullName = validateRepoFullName(body.repo_full_name);
    const apiKey = validateApiKey(request);

    const bundle = await refreshArchitectureBundle({
      userId: user.id,
      repoFullName: fullName,
      apiKey,
    });

    return NextResponse.json({
      architectureBundle: bundle,
      analysis: getArchitectureView(bundle, "system"),
      analyzedAt: bundle.generatedAt,
      architectureStatus: "ready",
      architectureForSha: bundle.sourceSha,
      isStale: false,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
