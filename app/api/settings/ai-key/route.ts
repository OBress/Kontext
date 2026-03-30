import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { storeAiKey, removeAiKey, resolveAiKey } from "@/lib/api/ai-key";
import { validateApiKey } from "@/lib/api/validate";

/**
 * GET /api/settings/ai-key — Retrieve the user's stored Google AI key.
 * Returns the key if stored, null otherwise.
 */
export async function GET() {
  try {
    const { user } = await getAuthenticatedUser();
    const key = await resolveAiKey(user.id);

    return NextResponse.json({ key });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/settings/ai-key — Persist the user's Google AI key (encrypted)
 * for background use by webhooks.
 *
 * Reads the key from the x-google-api-key header (same as all other calls).
 */
export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUser();
    const apiKey = validateApiKey(request);

    await storeAiKey(user.id, apiKey);

    return NextResponse.json({ stored: true });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/settings/ai-key — Remove the stored AI key.
 */
export async function DELETE() {
  try {
    const { user } = await getAuthenticatedUser();

    await removeAiKey(user.id);

    return NextResponse.json({ removed: true });
  } catch (error) {
    return handleApiError(error);
  }
}

