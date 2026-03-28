import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { rateLimit } from "@/lib/api/rate-limit";
import { handleApiError } from "@/lib/api/errors";

/**
 * GET /api/activity — Fetch the authenticated user's recent activity events.
 * Supports: ?limit=20 (default 20, max 50)
 *           &event_types=push,repo_indexed (optional comma-separated filter)
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const rl = rateLimit(user.id, "activity");
    if (!rl.ok) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        { status: 429 }
      );
    }

    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = Math.min(Math.max(parseInt(limitParam || "20", 10) || 20, 1), 50);

    // Get user's activity filter preferences
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("activity_filters")
      .eq("user_id", user.id)
      .single();

    // Build list of enabled event types from preferences
    let enabledTypes: string[] | null = null;
    if (prefs?.activity_filters) {
      const filters = prefs.activity_filters as Record<string, boolean>;
      enabledTypes = Object.entries(filters)
        .filter(([, enabled]) => enabled)
        .map(([type]) => type);

      // If user disabled everything, return empty
      if (enabledTypes.length === 0) {
        return NextResponse.json({ events: [] });
      }
    }

    // Also allow client-side type filter override
    const eventTypesParam = request.nextUrl.searchParams.get("event_types");
    if (eventTypesParam) {
      const requestedTypes = eventTypesParam.split(",").map((t) => t.trim());
      // Intersect with user preferences if they exist
      if (enabledTypes) {
        enabledTypes = requestedTypes.filter((t) => enabledTypes!.includes(t));
      } else {
        enabledTypes = requestedTypes;
      }
    }

    let query = supabase
      .from("activity_events")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (enabledTypes && enabledTypes.length > 0) {
      query = query.in("event_type", enabledTypes);
    }

    const { data: events, error } = await query;

    if (error) throw error;

    return NextResponse.json({ events: events || [] });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/activity — Clear activity events.
 *   ?id=123  → delete a single event
 *   (no id)  → clear ALL activity for the user
 */
export async function DELETE(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const eventId = request.nextUrl.searchParams.get("id");

    if (eventId) {
      // Delete single event
      const { error } = await supabase
        .from("activity_events")
        .delete()
        .eq("id", parseInt(eventId, 10))
        .eq("user_id", user.id);

      if (error) throw error;
      return NextResponse.json({ deleted: 1 });
    }

    // Clear all activity
    const { error, count } = await supabase
      .from("activity_events")
      .delete({ count: "exact" })
      .eq("user_id", user.id);

    if (error) throw error;
    return NextResponse.json({ deleted: count || 0 });
  } catch (error) {
    return handleApiError(error);
  }
}
