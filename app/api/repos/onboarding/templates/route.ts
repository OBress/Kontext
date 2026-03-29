import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import {
  assertRepoTeamAccess,
  duplicateOnboardingTemplate,
  listOnboardingTemplates,
  publishOnboardingTemplate,
  saveOnboardingTemplateDraft,
} from "@/lib/api/onboarding";
import { validateRepoFullName } from "@/lib/api/validate";

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const repoFullName = validateRepoFullName(
      request.nextUrl.searchParams.get("repo")
    );

    await assertRepoTeamAccess(supabase, user.id, repoFullName, [
      "owner",
      "admin",
      "member",
      "viewer",
    ]);

    const payload = await listOnboardingTemplates(
      supabase,
      user.id,
      repoFullName
    );

    return NextResponse.json(payload);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const body = await request.json();
    const repoFullName = validateRepoFullName(body.repo_full_name);

    await assertRepoTeamAccess(supabase, user.id, repoFullName);

    if (body.action === "duplicate") {
      const templateId = Number(body.template_id);
      if (!Number.isFinite(templateId)) {
        return NextResponse.json(
          { error: { message: "template_id is required to duplicate." } },
          { status: 400 }
        );
      }

      const template = await duplicateOnboardingTemplate({
        supabase,
        userId: user.id,
        repoFullName,
        templateId,
        createdBy: user.id,
      });

      return NextResponse.json({ template });
    }

    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : "Repository onboarding";
    const description =
      typeof body.description === "string" ? body.description : "";

    const template = await saveOnboardingTemplateDraft({
      supabase,
      userId: user.id,
      repoFullName,
      templateId:
        typeof body.template_id === "number" ? body.template_id : null,
      createdBy: user.id,
      title,
      description,
      steps: Array.isArray(body.steps) ? body.steps : [],
      metadata:
        body.metadata && typeof body.metadata === "object" ? body.metadata : {},
    });

    return NextResponse.json({ template });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const body = await request.json();
    const repoFullName = validateRepoFullName(body.repo_full_name);

    await assertRepoTeamAccess(supabase, user.id, repoFullName);

    if (body.action === "publish") {
      const templateId = Number(body.template_id);
      if (!Number.isFinite(templateId)) {
        return NextResponse.json(
          { error: { message: "template_id is required to publish." } },
          { status: 400 }
        );
      }

      const activeVersionId = await publishOnboardingTemplate({
        supabase,
        userId: user.id,
        repoFullName,
        templateId,
        publishedBy: user.id,
      });

      return NextResponse.json({ activeVersionId });
    }

    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : "Repository onboarding";

    const template = await saveOnboardingTemplateDraft({
      supabase,
      userId: user.id,
      repoFullName,
      templateId: Number(body.template_id),
      createdBy: user.id,
      title,
      description:
        typeof body.description === "string" ? body.description : "",
      steps: Array.isArray(body.steps) ? body.steps : [],
      metadata:
        body.metadata && typeof body.metadata === "object" ? body.metadata : {},
    });

    return NextResponse.json({ template });
  } catch (error) {
    return handleApiError(error);
  }
}
