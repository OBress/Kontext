export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity_events: {
        Row: {
          created_at: string | null
          description: string | null
          event_type: string
          id: number
          metadata: Json | null
          repo_full_name: string | null
          source: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          event_type: string
          id?: number
          metadata?: Json | null
          repo_full_name?: string | null
          source?: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          event_type?: string
          id?: number
          metadata?: Json | null
          repo_full_name?: string | null
          source?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_sessions: {
        Row: {
          created_at: string | null
          id: number
          messages: Json | null
          repo_full_name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          messages?: Json | null
          repo_full_name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: number
          messages?: Json | null
          repo_full_name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      generated_prompts: {
        Row: {
          created_at: string | null
          custom_instructions: string | null
          detected_stack: Json | null
          id: number
          prompt_text: string
          repo_full_name: string
          target: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          custom_instructions?: string | null
          detected_stack?: Json | null
          id?: number
          prompt_text: string
          repo_full_name: string
          target?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          custom_instructions?: string | null
          detected_stack?: Json | null
          id?: number
          prompt_text?: string
          repo_full_name?: string
          target?: string
          user_id?: string
        }
        Relationships: []
      }
      ingestion_jobs: {
        Row: {
          chunks_created: number | null
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          files_processed: number | null
          files_total: number | null
          id: number
          repo_full_name: string
          started_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          chunks_created?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          files_processed?: number | null
          files_total?: number | null
          id?: number
          repo_full_name: string
          started_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          chunks_created?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          files_processed?: number | null
          files_total?: number | null
          id?: number
          repo_full_name?: string
          started_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      mcp_api_keys: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: number
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          repo_full_name: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: number
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          repo_full_name?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: number
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          repo_full_name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      repo_check_configs: {
        Row: {
          check_type: string
          created_at: string
          enabled: boolean
          id: number
          notify_on_high: boolean
          repo_full_name: string
          trigger_mode: string
          updated_at: string
          user_id: string
        }
        Insert: {
          check_type: string
          created_at?: string
          enabled?: boolean
          id?: number
          notify_on_high?: boolean
          repo_full_name: string
          trigger_mode?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          check_type?: string
          created_at?: string
          enabled?: boolean
          id?: number
          notify_on_high?: boolean
          repo_full_name?: string
          trigger_mode?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      repo_check_findings: {
        Row: {
          category: string | null
          check_type: string
          confidence: number
          created_at: string
          evidence: string | null
          file_path: string | null
          fingerprint: string
          first_seen_at: string
          first_seen_sha: string | null
          fixed_in_run_id: number | null
          fixed_in_sha: string | null
          id: number
          last_run_id: number | null
          last_seen_at: string
          last_seen_sha: string | null
          metadata: Json
          opened_in_run_id: number | null
          recommendation: string | null
          related_files: Json
          repo_full_name: string
          resolved_at: string | null
          severity: string
          status: string
          summary: string
          symbol: string | null
          title: string
          transition_state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          check_type: string
          confidence?: number
          created_at?: string
          evidence?: string | null
          file_path?: string | null
          fingerprint: string
          first_seen_at?: string
          first_seen_sha?: string | null
          fixed_in_run_id?: number | null
          fixed_in_sha?: string | null
          id?: number
          last_run_id?: number | null
          last_seen_at?: string
          last_seen_sha?: string | null
          metadata?: Json
          opened_in_run_id?: number | null
          recommendation?: string | null
          related_files?: Json
          repo_full_name: string
          resolved_at?: string | null
          severity?: string
          status?: string
          summary: string
          symbol?: string | null
          title: string
          transition_state?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          check_type?: string
          confidence?: number
          created_at?: string
          evidence?: string | null
          file_path?: string | null
          fingerprint?: string
          first_seen_at?: string
          first_seen_sha?: string | null
          fixed_in_run_id?: number | null
          fixed_in_sha?: string | null
          id?: number
          last_run_id?: number | null
          last_seen_at?: string
          last_seen_sha?: string | null
          metadata?: Json
          opened_in_run_id?: number | null
          recommendation?: string | null
          related_files?: Json
          repo_full_name?: string
          resolved_at?: string | null
          severity?: string
          status?: string
          summary?: string
          symbol?: string | null
          title?: string
          transition_state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repo_check_findings_fixed_in_run_id_fkey"
            columns: ["fixed_in_run_id"]
            isOneToOne: false
            referencedRelation: "repo_check_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repo_check_findings_last_run_id_fkey"
            columns: ["last_run_id"]
            isOneToOne: false
            referencedRelation: "repo_check_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repo_check_findings_opened_in_run_id_fkey"
            columns: ["opened_in_run_id"]
            isOneToOne: false
            referencedRelation: "repo_check_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      repo_check_runs: {
        Row: {
          base_sha: string | null
          changed_files: Json
          created_at: string
          dedupe_key: string | null
          error_message: string | null
          findings_total: number
          finished_at: string | null
          head_sha: string | null
          id: number
          metadata: Json
          new_findings: number
          repo_full_name: string
          requested_check_types: Json
          resolved_findings: number
          started_at: string | null
          status: string
          summary: string | null
          trigger_mode: string
          unchanged_findings: number
          updated_at: string
          user_id: string
        }
        Insert: {
          base_sha?: string | null
          changed_files?: Json
          created_at?: string
          dedupe_key?: string | null
          error_message?: string | null
          findings_total?: number
          finished_at?: string | null
          head_sha?: string | null
          id?: number
          metadata?: Json
          new_findings?: number
          repo_full_name: string
          requested_check_types?: Json
          resolved_findings?: number
          started_at?: string | null
          status?: string
          summary?: string | null
          trigger_mode?: string
          unchanged_findings?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          base_sha?: string | null
          changed_files?: Json
          created_at?: string
          dedupe_key?: string | null
          error_message?: string | null
          findings_total?: number
          finished_at?: string | null
          head_sha?: string | null
          id?: number
          metadata?: Json
          new_findings?: number
          repo_full_name?: string
          requested_check_types?: Json
          resolved_findings?: number
          started_at?: string | null
          status?: string
          summary?: string | null
          trigger_mode?: string
          unchanged_findings?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      repo_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string | null
          embedding: string | null
          file_path: string
          fts: unknown
          id: number
          metadata: Json | null
          repo_full_name: string
          token_count: number
          user_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string | null
          embedding?: string | null
          file_path: string
          fts?: unknown
          id?: number
          metadata?: Json | null
          repo_full_name: string
          token_count?: number
          user_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string | null
          embedding?: string | null
          file_path?: string
          fts?: unknown
          id?: number
          metadata?: Json | null
          repo_full_name?: string
          token_count?: number
          user_id?: string
        }
        Relationships: []
      }
      repo_commits: {
        Row: {
          ai_summary: string | null
          ai_summary_embedding: string | null
          author_avatar_url: string | null
          author_name: string | null
          committed_at: string
          created_at: string | null
          files_changed: Json | null
          id: number
          message: string
          push_group_id: string | null
          repo_full_name: string
          sha: string
          sync_triggered: boolean | null
          user_id: string
        }
        Insert: {
          ai_summary?: string | null
          ai_summary_embedding?: string | null
          author_avatar_url?: string | null
          author_name?: string | null
          committed_at: string
          created_at?: string | null
          files_changed?: Json | null
          id?: number
          message: string
          push_group_id?: string | null
          repo_full_name: string
          sha: string
          sync_triggered?: boolean | null
          user_id: string
        }
        Update: {
          ai_summary?: string | null
          ai_summary_embedding?: string | null
          author_avatar_url?: string | null
          author_name?: string | null
          committed_at?: string
          created_at?: string | null
          files_changed?: Json | null
          id?: number
          message?: string
          push_group_id?: string | null
          repo_full_name?: string
          sha?: string
          sync_triggered?: boolean | null
          user_id?: string
        }
        Relationships: []
      }
      repo_files: {
        Row: {
          content_hash: string | null
          created_at: string | null
          extension: string | null
          file_name: string
          file_path: string
          id: number
          imports: string[] | null
          line_count: number | null
          repo_full_name: string
          size_bytes: number | null
          user_id: string
        }
        Insert: {
          content_hash?: string | null
          created_at?: string | null
          extension?: string | null
          file_name: string
          file_path: string
          id?: number
          imports?: string[] | null
          line_count?: number | null
          repo_full_name: string
          size_bytes?: number | null
          user_id: string
        }
        Update: {
          content_hash?: string | null
          created_at?: string | null
          extension?: string | null
          file_name?: string
          file_path?: string
          id?: number
          imports?: string[] | null
          line_count?: number | null
          repo_full_name?: string
          size_bytes?: number | null
          user_id?: string
        }
        Relationships: []
      }
      repos: {
        Row: {
          architecture_analysis: Json | null
          architecture_analyzed_at: string | null
          architecture_error: string | null
          architecture_for_sha: string | null
          architecture_status: string | null
          auto_sync_enabled: boolean | null
          chunk_count: number | null
          created_at: string | null
          custom_github_token: string | null
          custom_token_iv: string | null
          custom_token_tag: string | null
          default_branch: string | null
          description: string | null
          forks_count: number | null
          full_name: string
          github_id: number
          id: number
          indexed: boolean | null
          indexing: boolean | null
          language: string | null
          last_indexed_at: string | null
          last_synced_sha: string | null
          name: string
          owner: string
          pending_sync_head_sha: string | null
          stargazers_count: number | null
          sync_blocked_reason: string | null
          understanding_tier: number | null
          updated_at: string | null
          user_id: string
          watched_branch: string | null
          webhook_id: number | null
        }
        Insert: {
          architecture_analysis?: Json | null
          architecture_analyzed_at?: string | null
          architecture_error?: string | null
          architecture_for_sha?: string | null
          architecture_status?: string | null
          auto_sync_enabled?: boolean | null
          chunk_count?: number | null
          created_at?: string | null
          custom_github_token?: string | null
          custom_token_iv?: string | null
          custom_token_tag?: string | null
          default_branch?: string | null
          description?: string | null
          forks_count?: number | null
          full_name: string
          github_id: number
          id?: number
          indexed?: boolean | null
          indexing?: boolean | null
          language?: string | null
          last_indexed_at?: string | null
          last_synced_sha?: string | null
          name: string
          owner: string
          pending_sync_head_sha?: string | null
          stargazers_count?: number | null
          sync_blocked_reason?: string | null
          understanding_tier?: number | null
          updated_at?: string | null
          user_id: string
          watched_branch?: string | null
          webhook_id?: number | null
        }
        Update: {
          architecture_analysis?: Json | null
          architecture_analyzed_at?: string | null
          architecture_error?: string | null
          architecture_for_sha?: string | null
          architecture_status?: string | null
          auto_sync_enabled?: boolean | null
          chunk_count?: number | null
          created_at?: string | null
          custom_github_token?: string | null
          custom_token_iv?: string | null
          custom_token_tag?: string | null
          default_branch?: string | null
          description?: string | null
          forks_count?: number | null
          full_name?: string
          github_id?: number
          id?: number
          indexed?: boolean | null
          indexing?: boolean | null
          language?: string | null
          last_indexed_at?: string | null
          last_synced_sha?: string | null
          name?: string
          owner?: string
          pending_sync_head_sha?: string | null
          stargazers_count?: number | null
          sync_blocked_reason?: string | null
          understanding_tier?: number | null
          updated_at?: string | null
          user_id?: string
          watched_branch?: string | null
          webhook_id?: number | null
        }
        Relationships: []
      }
      team_invites: {
        Row: {
          created_at: string | null
          expires_at: string | null
          github_username: string
          id: number
          invited_by: string
          repo_full_name: string
          role: string
          status: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          github_username: string
          id?: number
          invited_by: string
          repo_full_name: string
          role?: string
          status?: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          github_username?: string
          id?: number
          invited_by?: string
          repo_full_name?: string
          role?: string
          status?: string
        }
        Relationships: []
      }
      team_members: {
        Row: {
          id: number
          invited_by: string | null
          joined_at: string | null
          onboarding_completed: boolean | null
          onboarding_step: number | null
          repo_full_name: string
          role: string
          user_id: string
        }
        Insert: {
          id?: number
          invited_by?: string | null
          joined_at?: string | null
          onboarding_completed?: boolean | null
          onboarding_step?: number | null
          repo_full_name: string
          role?: string
          user_id: string
        }
        Update: {
          id?: number
          invited_by?: string | null
          joined_at?: string | null
          onboarding_completed?: boolean | null
          onboarding_step?: number | null
          repo_full_name?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          activity_filters: Json | null
          created_at: string | null
          id: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          activity_filters?: Json | null
          created_at?: string | null
          id?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          activity_filters?: Json | null
          created_at?: string | null
          id?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_tokens: {
        Row: {
          ai_key_iv: string | null
          ai_key_tag: string | null
          created_at: string | null
          encrypted_ai_key: string | null
          encrypted_token: string
          expires_at: string | null
          id: number
          provider: string
          refresh_token: string | null
          token_iv: string
          token_tag: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ai_key_iv?: string | null
          ai_key_tag?: string | null
          created_at?: string | null
          encrypted_ai_key?: string | null
          encrypted_token: string
          expires_at?: string | null
          id?: number
          provider?: string
          refresh_token?: string | null
          token_iv: string
          token_tag: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          ai_key_iv?: string | null
          ai_key_tag?: string | null
          created_at?: string | null
          encrypted_ai_key?: string | null
          encrypted_token?: string
          expires_at?: string | null
          id?: number
          provider?: string
          refresh_token?: string | null
          token_iv?: string
          token_tag?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          created_at: string | null
          delivery_id: string
          event_type: string
          id: number
          payload: Json
          processed: boolean | null
          repo_full_name: string
        }
        Insert: {
          created_at?: string | null
          delivery_id: string
          event_type: string
          id?: number
          payload: Json
          processed?: boolean | null
          repo_full_name: string
        }
        Update: {
          created_at?: string | null
          delivery_id?: string
          event_type?: string
          id?: number
          payload?: Json
          processed?: boolean | null
          repo_full_name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      hybrid_match_chunks: {
        Args: {
          filter_repo?: string
          filter_user_id?: string
          full_text_weight?: number
          match_count?: number
          query_embedding: string
          query_text: string
          rrf_k?: number
          semantic_weight?: number
        }
        Returns: {
          content: string
          file_path: string
          id: number
          similarity: number
        }[]
      }
      match_chunks: {
        Args: {
          filter_repo?: string
          filter_user_id?: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          content: string
          file_path: string
          id: number
          similarity: number
        }[]
      }
      match_timeline: {
        Args: {
          filter_repo?: string
          filter_user_id?: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          ai_summary: string
          author_avatar_url: string
          author_name: string
          committed_at: string
          files_changed: Json
          id: number
          message: string
          push_group_id: string
          sha: string
          similarity: number
        }[]
      }
      replace_repo_index: {
        Args: {
          p_chunk_count: number
          p_chunks: Json
          p_files: Json
          p_indexed?: boolean
          p_indexing?: boolean
          p_last_indexed_at: string
          p_last_synced_sha?: string
          p_pending_sync_head_sha?: string
          p_repo_full_name: string
          p_sync_blocked_reason?: string
          p_user_id: string
          p_watched_branch?: string
        }
        Returns: undefined
      }
      replace_repo_paths: {
        Args: {
          p_chunk_count: number
          p_chunks: Json
          p_files: Json
          p_last_indexed_at: string
          p_last_synced_sha: string
          p_pending_sync_head_sha?: string
          p_remove_paths: string[]
          p_repo_full_name: string
          p_sync_blocked_reason?: string
          p_user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
