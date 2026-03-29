import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { ApiError, handleApiError } from "@/lib/api/errors";
import {
  getCurrentOnboardingExperience,
  submitCurrentOnboardingQuizAttempt,
  updateCurrentOnboardingProgress,
} from "@/lib/api/onboarding";
import { validateRepoFullName } from "@/lib/api/validate";

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const repoFullName = validateRepoFullName(
      request.nextUrl.searchParams.get("repo")
    );

    const experience = await getCurrentOnboardingExperience({
      supabase,
      userId: user.id,
      repoFullName,
      assigneeUserId: user.id,
      githubLogin: user.githubLogin || null,
    });

    return NextResponse.json(experience);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const body = await request.json();
    const repoFullName = validateRepoFullName(body.repo_full_name);

    if (!["start", "save_progress", "complete"].includes(body.action)) {
      throw new ApiError(
        400,
        "INVALID_ACTION",
        "action must be start, save_progress, or complete."
      );
    }

    const experience = await updateCurrentOnboardingProgress({
      supabase,
      userId: user.id,
      repoFullName,
      assigneeUserId: user.id,
      githubLogin: user.githubLogin || null,
      action: body.action,
      currentStep:
        typeof body.current_step === "number" ? body.current_step : undefined,
    });

    return NextResponse.json(experience);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const body = await request.json();
    const repoFullName = validateRepoFullName(body.repo_full_name);

    if (body.action !== "submit_quiz") {
      throw new ApiError(
        400,
        "INVALID_ACTION",
        "action must be submit_quiz."
      );
    }

    const stepOrder = Number(body.step_order);
    const selectedOptionIndex = Number(body.selected_option_index);

    if (!Number.isFinite(stepOrder) || !Number.isFinite(selectedOptionIndex)) {
      throw new ApiError(
        400,
        "INVALID_INPUT",
        "step_order and selected_option_index are required."
      );
    }

    const result = await submitCurrentOnboardingQuizAttempt({
      supabase,
      userId: user.id,
      repoFullName,
      assigneeUserId: user.id,
      githubLogin: user.githubLogin || null,
      stepOrder,
      selectedOptionIndex,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
