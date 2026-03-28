import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { handleApiError } from "@/lib/api/errors";
import { DEFAULT_ACTIVITY_FILTERS } from "@/lib/api/activity";

/**
 * GET /api/settings/preferences — Get user preferences
 */
export async function GET() {
  try {
    const { user, supabase } = await getAuthenticatedUser();

    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!prefs) {
      // Return defaults if no preferences exist yet
      return NextResponse.json({
        preferences: {
          activity_filters: DEFAULT_ACTIVITY_FILTERS,
        },
      });
    }

    return NextResponse.json({ preferences: prefs });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/settings/preferences — Update user preferences
 */
export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await getAuthenticatedUser();
    const body = await request.json();

    const { activity_filters } = body;

    if (!activity_filters || typeof activity_filters !== "object") {
      return NextResponse.json(
        { error: { message: "activity_filters object is required" } },
        { status: 400 }
      );
    }

    // Merge with defaults to ensure all keys exist
    const merged = { ...DEFAULT_ACTIVITY_FILTERS, ...activity_filters };

    const { data, error } = await supabase
      .from("user_preferences")
      .upsert(
        {
          user_id: user.id,
          activity_filters: merged,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ preferences: data });
  } catch (error) {
    return handleApiError(error);
  }
}
