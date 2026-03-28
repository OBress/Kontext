import { createAdminClient } from "./auth";

export type ActivitySource = "kontext" | "github";

export type ActivityEventType =
  | "repo_added"
  | "repo_deleted"
  | "repo_indexed"
  | "team_member_joined"
  | "team_invite_sent"
  | "chat_session"
  | "prompt_generated"
  | "push"
  | "pull_request"
  | "issue"
  | "create"
  | "release";

export interface LogActivityParams {
  userId: string;
  repoFullName?: string;
  source: ActivitySource;
  eventType: ActivityEventType;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Log an activity event to the activity_events table.
 * Uses the admin client (service_role) to bypass RLS since this
 * is called from server-side API routes on behalf of the user.
 *
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    const adminDb = await createAdminClient();

    await adminDb.from("activity_events").insert({
      user_id: params.userId,
      repo_full_name: params.repoFullName || null,
      source: params.source,
      event_type: params.eventType,
      title: params.title,
      description: params.description || null,
      metadata: params.metadata || {},
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[activity] Failed to log event:", params.eventType, message);
  }
}

/**
 * Default activity filter preferences — all event types enabled.
 */
export const DEFAULT_ACTIVITY_FILTERS: Record<ActivityEventType, boolean> = {
  repo_added: true,
  repo_deleted: true,
  repo_indexed: true,
  team_member_joined: true,
  team_invite_sent: true,
  chat_session: true,
  prompt_generated: true,
  push: true,
  pull_request: true,
  issue: true,
  create: true,
  release: true,
};
