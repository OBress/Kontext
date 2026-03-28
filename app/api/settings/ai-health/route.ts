import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { validateApiKey } from "@/lib/api/validate";
import { runGeminiHealthCheck } from "@/lib/api/gemini";

/**
 * POST /api/settings/ai-health
 *
 * Performs lightweight generation + embedding checks against the current BYO key.
 */
export async function POST(request: Request) {
  try {
    await getAuthenticatedUser();
    const apiKey = validateApiKey(request);
    const health = await runGeminiHealthCheck(apiKey);
    return NextResponse.json(health);
  } catch (error) {
    return handleApiError(error);
  }
}
