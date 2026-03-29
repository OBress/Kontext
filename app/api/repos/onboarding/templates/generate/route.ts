import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import {
  assertRepoTeamAccess,
  generateOnboardingDraft,
} from "@/lib/api/onboarding";
import { validateRepoFullName } from "@/lib/api/validate";

export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const body = await request.json();
    const repoFullName = validateRepoFullName(body.repo_full_name);

    await assertRepoTeamAccess(supabase, user.id, repoFullName);

    const template = await generateOnboardingDraft({
      supabase,
      userId: user.id,
      repoFullName,
      requestedBy: user.id,
      apiKey: request.headers.get("x-google-api-key"),
    });

    return NextResponse.json({ template });
  } catch (error) {
    return handleApiError(error);
  }
}
