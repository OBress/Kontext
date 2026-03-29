import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { getQueueStatus } from "@/lib/api/sync-queue";

/**
 * GET /api/jobs/queue — Show current sync queue status for the authenticated user.
 *
 * Returns active operations, pending queue depth, and repo lock states.
 * Useful for debugging and the TaskIndicator UI.
 */
export async function GET() {
  try {
    const { user } = await getAuthenticatedUser();
    const [status] = getQueueStatus(user.id);

    return NextResponse.json({
      userId: user.id,
      activeCount: status?.activeCount || 0,
      maxConcurrent: status?.maxConcurrent || 3,
      activeLocks: status?.activeLocks || [],
      waitQueueDepth: status?.waitQueueDepth || 0,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
