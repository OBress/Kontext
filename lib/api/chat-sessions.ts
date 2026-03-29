import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizePersistedChatMessages,
  toPersistedChatMessages,
} from "@/lib/chat-messages";
import type { ChatMessage, PersistedChatMessage } from "@/types/chat";

interface ChatSessionRow {
  id: number;
  messages: unknown;
}

async function findRollingSession(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string
): Promise<ChatSessionRow | null> {
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("id, messages")
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw error;

  const rows = ((data || []) as ChatSessionRow[]).filter(
    (row) => typeof row.id === "number"
  );

  if (rows.length <= 1) {
    return rows[0] || null;
  }

  const [primary, ...duplicates] = rows;
  if (duplicates.length > 0) {
    await supabase
      .from("chat_sessions")
      .delete()
      .eq("user_id", userId)
      .eq("repo_full_name", repoFullName)
      .in(
        "id",
        duplicates.map((row) => row.id)
      );
  }

  return primary;
}

export async function loadRollingChatSession(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string
): Promise<PersistedChatMessage[]> {
  const session = await findRollingSession(supabase, userId, repoFullName);
  if (!session) return [];
  return normalizePersistedChatMessages(session.messages);
}

export async function saveRollingChatSession(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string,
  messages: ChatMessage[] | PersistedChatMessage[]
): Promise<PersistedChatMessage[]> {
  const normalized =
    messages.length > 0 && messages[0] && typeof (messages[0] as ChatMessage).timestamp !== "string"
      ? toPersistedChatMessages(messages as ChatMessage[])
      : normalizePersistedChatMessages(messages);

  const session = await findRollingSession(supabase, userId, repoFullName);

  if (session) {
    const { error } = await supabase
      .from("chat_sessions")
      .update({
        messages: normalized,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id)
      .eq("user_id", userId);

    if (error) throw error;
    return normalized;
  }

  const { error } = await supabase.from("chat_sessions").insert({
    user_id: userId,
    repo_full_name: repoFullName,
    messages: normalized,
    updated_at: new Date().toISOString(),
  });

  if (error) throw error;
  return normalized;
}

export async function clearRollingChatSession(
  supabase: SupabaseClient,
  userId: string,
  repoFullName: string
): Promise<void> {
  const { error } = await supabase
    .from("chat_sessions")
    .delete()
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName);

  if (error) throw error;
}
