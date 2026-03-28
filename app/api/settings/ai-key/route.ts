import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { storeAiKey, removeAiKey } from "@/lib/api/ai-key";
import { validateApiKey } from "@/lib/api/validate";

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
