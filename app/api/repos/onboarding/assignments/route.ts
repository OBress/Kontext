import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { ApiError, handleApiError } from "@/lib/api/errors";
import {
  assertRepoTeamAccess,
  listOnboardingAssignments,
} from "@/lib/api/onboarding";
import { validateRepoFullName } from "@/lib/api/validate";

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const repoFullName = validateRepoFullName(
      request.nextUrl.searchParams.get("repo")
    );

    await assertRepoTeamAccess(supabase, user.id, repoFullName);

    const payload = await listOnboardingAssignments(
      supabase,
      user.id,
      repoFullName
    );

    return NextResponse.json(payload);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const body = await request.json();
    const repoFullName = validateRepoFullName(body.repo_full_name);
    const assignmentId = Number(body.assignment_id);

    if (!Number.isFinite(assignmentId)) {
      throw new ApiError(400, "INVALID_ASSIGNMENT", "assignment_id is required.");
    }

    await assertRepoTeamAccess(supabase, user.id, repoFullName);

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof body.status === "string") updates.status = body.status;
    if (typeof body.progress_percent === "number") {
      updates.progress_percent = Math.max(
        0,
        Math.min(100, Math.round(body.progress_percent))
      );
    }
    if (typeof body.current_step === "number") {
      updates.current_step = Math.max(0, Math.round(body.current_step));
    }
    if (typeof body.score === "number") {
      updates.score = body.score;
    }
    if (typeof body.assignee_user_id === "string") {
      updates.assignee_user_id = body.assignee_user_id;
    }

    if (body.status === "in_progress") {
      updates.started_at = body.started_at || new Date().toISOString();
    }

    if (body.status === "completed") {
      updates.completed_at = body.completed_at || new Date().toISOString();
      updates.progress_percent = 100;
    }

    const { error } = await supabase
      .from("onboarding_assignments")
      .update(updates)
      .eq("id", assignmentId)
      .eq("user_id", user.id)
      .eq("repo_full_name", repoFullName);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
