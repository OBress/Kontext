import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError, validationError } from "@/lib/api/errors";
import {
  ensureRepoCheckConfigs,
  REPO_CHECK_TYPES,
} from "@/lib/api/repo-checks";
import { validateRepoFullName } from "@/lib/api/validate";

function isCheckType(value: unknown): value is (typeof REPO_CHECK_TYPES)[number] {
  return typeof value === "string" && REPO_CHECK_TYPES.includes(value as (typeof REPO_CHECK_TYPES)[number]);
}

/**
 * GET /api/repos/checks/config?repo=owner/name
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const repoFullName = validateRepoFullName(
      request.nextUrl.searchParams.get("repo") || ""
    );

    const { data: repo } = await supabase
      .from("repos")
      .select("full_name")
      .eq("user_id", user.id)
      .eq("full_name", repoFullName)
      .single();

    if (!repo) {
      return NextResponse.json({ error: "Repo not found" }, { status: 404 });
    }

    const configs = await ensureRepoCheckConfigs(supabase, user.id, repoFullName);
    return NextResponse.json({ configs });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/repos/checks/config
 *
 * Body:
 * {
 *   repo_full_name: string,
 *   configs: [{ check_type, enabled?, trigger_mode?, notify_on_high? }]
 * }
 */
export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const body = await request.json();
    const repoFullName = validateRepoFullName(body.repo_full_name);
    const configs = Array.isArray(body.configs) ? body.configs : [];

    if (configs.length === 0) {
      throw validationError("configs array is required");
    }

    const { data: repo } = await supabase
      .from("repos")
      .select("full_name")
      .eq("user_id", user.id)
      .eq("full_name", repoFullName)
      .single();

    if (!repo) {
      return NextResponse.json({ error: "Repo not found" }, { status: 404 });
    }

    await ensureRepoCheckConfigs(supabase, user.id, repoFullName);

    const rows = configs.map((config: Record<string, unknown>) => {
      if (!isCheckType(config?.check_type)) {
        throw validationError("Invalid check_type in configs");
      }

      const triggerMode =
        typeof config.trigger_mode === "string" ? config.trigger_mode : "after_sync";
      if (!["manual", "after_sync", "daily"].includes(triggerMode)) {
        throw validationError("trigger_mode must be manual, after_sync, or daily");
      }

      return {
        user_id: user.id,
        repo_full_name: repoFullName,
        check_type: config.check_type,
        enabled: config.enabled !== false,
        trigger_mode: triggerMode,
        notify_on_high: config.notify_on_high !== false,
        updated_at: new Date().toISOString(),
      };
    });

    const { error } = await supabase.from("repo_check_configs").upsert(rows, {
      onConflict: "user_id,repo_full_name,check_type",
    });

    if (error) throw error;

    const updated = await ensureRepoCheckConfigs(supabase, user.id, repoFullName);
    return NextResponse.json({ configs: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
