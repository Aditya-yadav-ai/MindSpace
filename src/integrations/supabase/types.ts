export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      agent_runs: {
        Row: {
          answer: string;
          automation_id: string | null;
          created_at: string;
          failed_count: number;
          goal: string;
          id: string;
          plan: Json;
          status: string;
          step_count: number;
          steps: Json;
          user_id: string;
          verification: Json;
          verification_score: number | null;
          verification_verdict: string | null;
        };
        Insert: {
          answer?: string;
          automation_id?: string | null;
          created_at?: string;
          failed_count?: number;
          goal: string;
          id: string;
          plan?: Json;
          status: string;
          step_count?: number;
          steps?: Json;
          user_id: string;
          verification?: Json;
          verification_score?: number | null;
          verification_verdict?: string | null;
        };
        Update: {
          answer?: string;
          automation_id?: string | null;
          created_at?: string;
          failed_count?: number;
          goal?: string;
          id?: string;
          plan?: Json;
          status?: string;
          step_count?: number;
          steps?: Json;
          user_id?: string;
          verification?: Json;
          verification_score?: number | null;
          verification_verdict?: string | null;
        };
        Relationships: [];
      };
      automation_runs: {
        Row: {
          agent_run_id: string | null;
          automation_id: string;
          id: string;
          ran_at: string;
          status: string;
          summary: string;
          user_id: string;
        };
        Insert: {
          agent_run_id?: string | null;
          automation_id: string;
          id?: string;
          ran_at?: string;
          status: string;
          summary?: string;
          user_id: string;
        };
        Update: {
          agent_run_id?: string | null;
          automation_id?: string;
          id?: string;
          ran_at?: string;
          status?: string;
          summary?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automation_runs_agent_run_id_fkey";
            columns: ["agent_run_id"];
            isOneToOne: false;
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_runs_automation_id_fkey";
            columns: ["automation_id"];
            isOneToOne: false;
            referencedRelation: "automations";
            referencedColumns: ["id"];
          },
        ];
      };
      automations: {
        Row: {
          approved_tools: string[];
          created_at: string;
          enabled: boolean;
          goal: string;
          id: string;
          last_run_at: string | null;
          name: string;
          next_run_at: string;
          schedule_day_of_week: number | null;
          schedule_hour: number;
          schedule_kind: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          approved_tools?: string[];
          created_at?: string;
          enabled?: boolean;
          goal: string;
          id?: string;
          last_run_at?: string | null;
          name: string;
          next_run_at?: string;
          schedule_day_of_week?: number | null;
          schedule_hour?: number;
          schedule_kind?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          approved_tools?: string[];
          created_at?: string;
          enabled?: boolean;
          goal?: string;
          id?: string;
          last_run_at?: string | null;
          name?: string;
          next_run_at?: string;
          schedule_day_of_week?: number | null;
          schedule_hour?: number;
          schedule_kind?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      chat_turns: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          page_title: string | null;
          page_url: string | null;
          role: string;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          page_title?: string | null;
          page_url?: string | null;
          role: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          page_title?: string | null;
          page_url?: string | null;
          role?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      document_chunks: {
        Row: {
          chunk_index: number;
          content: string;
          created_at: string;
          document_id: string;
          embedding: string | null;
          id: string;
          user_id: string;
        };
        Insert: {
          chunk_index: number;
          content: string;
          created_at?: string;
          document_id: string;
          embedding?: string | null;
          id?: string;
          user_id: string;
        };
        Update: {
          chunk_index?: number;
          content?: string;
          created_at?: string;
          document_id?: string;
          embedding?: string | null;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          char_count: number;
          chunk_count: number;
          content: string;
          created_at: string;
          error: string | null;
          id: string;
          kind: string;
          source_name: string;
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          char_count?: number;
          chunk_count?: number;
          content?: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          kind?: string;
          source_name?: string;
          status?: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          char_count?: number;
          chunk_count?: number;
          content?: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          kind?: string;
          source_name?: string;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      google_connections: {
        Row: {
          access_token_expires_at: string;
          created_at: string;
          encrypted_access_token: string;
          encrypted_refresh_token: string;
          google_email: string | null;
          scope: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          access_token_expires_at: string;
          created_at?: string;
          encrypted_access_token: string;
          encrypted_refresh_token: string;
          google_email?: string | null;
          scope?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          access_token_expires_at?: string;
          created_at?: string;
          encrypted_access_token?: string;
          encrypted_refresh_token?: string;
          google_email?: string | null;
          scope?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      google_oauth_states: {
        Row: {
          code_verifier: string;
          created_at: string;
          expires_at: string;
          state: string;
          user_id: string;
        };
        Insert: {
          code_verifier: string;
          created_at?: string;
          expires_at: string;
          state: string;
          user_id: string;
        };
        Update: {
          code_verifier?: string;
          created_at?: string;
          expires_at?: string;
          state?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          created_at: string;
          due_at: string | null;
          id: string;
          notes: string;
          source: string;
          source_run_id: string | null;
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          due_at?: string | null;
          id?: string;
          notes?: string;
          source?: string;
          source_run_id?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          due_at?: string | null;
          id?: string;
          notes?: string;
          source?: string;
          source_run_id?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_memories: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          pinned: boolean;
          source: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          pinned?: boolean;
          source?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          pinned?: boolean;
          source?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      match_document_chunks: {
        Args: {
          match_count?: number;
          query_embedding: string;
          similarity_threshold?: number;
        };
        Returns: {
          chunk_id: string;
          chunk_index: number;
          content: string;
          document_id: string;
          document_title: string;
          similarity: number;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
