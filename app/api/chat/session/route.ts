import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { loadRollingChatSession, clearRollingChatSession } from "@/lib/api/chat-sessions";
import { validateRepoFullName } from "@/lib/api/validate";

function getRepoFromRequest(request: Request): string {
  const { searchParams } = new URL(request.url);
  return validateRepoFullName(searchParams.get("repo"));
}

export async function GET(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const repoFullName = getRepoFromRequest(request);
    const messages = await loadRollingChatSession(supabase, user.id, repoFullName);

    return NextResponse.json({
      repo_full_name: repoFullName,
      messages,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const repoFullName = getRepoFromRequest(request);
    await clearRollingChatSession(supabase, user.id, repoFullName);

    return NextResponse.json({
      ok: true,
      repo_full_name: repoFullName,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
