import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError, ApiError } from "@/lib/api/errors";

/**
 * POST /api/repos/checks/findings/dismiss
 * Body: { finding_ids: number[] }
 * Dismisses (blacklists) one or more findings so they are hidden by default.
 *
 * DELETE /api/repos/checks/findings/dismiss
 * Body: { finding_ids: number[] }
 * Restores previously dismissed findings.
 */

function validateFindingIds(body: unknown): number[] {
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "VALIDATION_ERROR", "Request body is required");
  }

  const { finding_ids } = body as { finding_ids?: unknown };

  if (!Array.isArray(finding_ids) || finding_ids.length === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "finding_ids must be a non-empty array of numbers");
  }

  if (finding_ids.length > 50) {
    throw new ApiError(400, "VALIDATION_ERROR", "Cannot dismiss more than 50 findings at once");
  }

  const ids = finding_ids.map((id) => {
    const num = Number(id);
    if (!Number.isFinite(num) || num <= 0) {
      throw new ApiError(400, "VALIDATION_ERROR", `Invalid finding ID: ${String(id)}`);
    }
    return num;
  });

  return ids;
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const body = await request.json();
    const findingIds = validateFindingIds(body);

    const { error } = await supabase
      .from("repo_check_findings")
      .update({ dismissed_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .in("id", findingIds)
      .is("dismissed_at", null);

    if (error) throw error;

    return NextResponse.json({ dismissed: findingIds.length });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const body = await request.json();
    const findingIds = validateFindingIds(body);

    const { error } = await supabase
      .from("repo_check_findings")
      .update({ dismissed_at: null })
      .eq("user_id", user.id)
      .in("id", findingIds)
      .not("dismissed_at", "is", null);

    if (error) throw error;

    return NextResponse.json({ restored: findingIds.length });
  } catch (error) {
    return handleApiError(error);
  }
}
