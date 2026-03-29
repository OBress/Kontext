import { createAdminClient } from "./auth";
import {
  DEFAULT_ACTIVITY_FILTERS,
  type ActivityEventType,
} from "@/lib/activity";

export type ActivitySource = "kontext" | "github";

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

export { DEFAULT_ACTIVITY_FILTERS };
