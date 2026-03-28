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
      repo_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string | null
          embedding: string | null
          file_path: string
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
          id?: number
          metadata?: Json | null
          repo_full_name?: string
          token_count?: number
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
          chunk_count: number | null
          created_at: string | null
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
          name: string
          owner: string
          stargazers_count: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          chunk_count?: number | null
          created_at?: string | null
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
          name: string
          owner: string
          stargazers_count?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          chunk_count?: number | null
          created_at?: string | null
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
          name?: string
          owner?: string
          stargazers_count?: number | null
          updated_at?: string | null
          user_id?: string
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
      user_tokens: {
        Row: {
          created_at: string | null
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
          created_at?: string | null
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
          created_at?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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

