import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError, ApiError } from "@/lib/api/errors";
import { validateRepoFullName, validateRole, validateGitHubUsername } from "@/lib/api/validate";
import { logActivity } from "@/lib/api/activity";

/**
 * GET /api/team?repo=owner/name — List team members
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "team");
    if (!rl.ok) {
      return NextResponse.json({ error: { code: "RATE_LIMITED" } }, { status: 429 });
    }

    const repoFullName = request.nextUrl.searchParams.get("repo");
    if (!repoFullName) {
      return NextResponse.json({ error: { message: "repo is required" } }, { status: 400 });
    }
    validateRepoFullName(repoFullName);

    // Verify caller is a member of this repo
    const { data: membership } = await supabase
      .from("team_members")
      .select("role")
      .eq("repo_full_name", repoFullName)
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      throw new ApiError(403, "FORBIDDEN", "You are not a member of this repository team");
    }

    // Get all members
    const { data: members } = await supabase
      .from("team_members")
      .select("*")
      .eq("repo_full_name", repoFullName)
      .order("joined_at", { ascending: true });

    // Get pending invites (only for owners/admins)
    let invites: Record<string, unknown>[] = [];
    if (["owner", "admin"].includes(membership.role)) {
      const { data } = await supabase
        .from("team_invites")
        .select("*")
        .eq("repo_full_name", repoFullName)
        .eq("status", "pending");
      invites = data || [];
    }

    return NextResponse.json({ members: members || [], invites, callerRole: membership.role });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/team — Send invite
 */
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const body = await request.json();
    const repoFullName = validateRepoFullName(body.repo_full_name);
    const githubUsername = validateGitHubUsername(body.github_username);
    const role = validateRole(body.role);

    // Verify caller is owner/admin
    const { data: membership } = await supabase
      .from("team_members")
      .select("role")
      .eq("repo_full_name", repoFullName)
      .eq("user_id", user.id)
      .single();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      throw new ApiError(403, "FORBIDDEN", "Only owners and admins can invite members");
    }

    // Create invite
    const { data: invite, error } = await supabase
      .from("team_invites")
      .insert({
        repo_full_name: repoFullName,
        invited_by: user.id,
        github_username: githubUsername,
        role,
      })
      .select()
      .single();

    if (error) throw error;

    // Log activity event
    logActivity({
      userId: user.id,
      repoFullName,
      source: "kontext",
      eventType: "team_invite_sent",
      title: `Invited @${githubUsername} to ${repoFullName}`,
      description: `Role: ${role}`,
      metadata: { github_username: githubUsername, role },
    });

    return NextResponse.json({ invite });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/team — Update member role
 */
export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const body = await request.json();
    const repoFullName = validateRepoFullName(body.repo_full_name);
    const targetUserId = body.user_id;
    const newRole = validateRole(body.role);

    // Verify caller is owner/admin
    const { data: membership } = await supabase
      .from("team_members")
      .select("role")
      .eq("repo_full_name", repoFullName)
      .eq("user_id", user.id)
      .single();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      throw new ApiError(403, "FORBIDDEN", "Insufficient permissions");
    }

    const { error } = await supabase
      .from("team_members")
      .update({ role: newRole })
      .eq("repo_full_name", repoFullName)
      .eq("user_id", targetUserId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/team — Remove member
 */
export async function DELETE(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const body = await request.json();
    const repoFullName = validateRepoFullName(body.repo_full_name);
    const targetUserId = body.user_id;

    // Users can remove themselves, or owners/admins can remove others
    if (targetUserId !== user.id) {
      const { data: membership } = await supabase
        .from("team_members")
        .select("role")
        .eq("repo_full_name", repoFullName)
        .eq("user_id", user.id)
        .single();

      if (!membership || !["owner", "admin"].includes(membership.role)) {
        throw new ApiError(403, "FORBIDDEN", "Insufficient permissions");
      }
    }

    const { error } = await supabase
      .from("team_members")
      .delete()
      .eq("repo_full_name", repoFullName)
      .eq("user_id", targetUserId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
