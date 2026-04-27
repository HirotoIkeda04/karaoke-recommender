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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      evaluations: {
        Row: {
          created_at: string
          key_shift: number | null
          memo: string | null
          rating: Database["public"]["Enums"]["rating_type"]
          song_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          key_shift?: number | null
          memo?: string | null
          rating: Database["public"]["Enums"]["rating_type"]
          song_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          key_shift?: number | null
          memo?: string | null
          rating?: Database["public"]["Enums"]["rating_type"]
          song_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evaluations_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "songs"
            referencedColumns: ["id"]
          },
        ]
      }
      songs: {
        Row: {
          artist: string
          created_at: string
          dam_request_no: string | null
          falsetto_max_midi: number | null
          id: string
          image_url_large: string | null
          image_url_medium: string | null
          image_url_small: string | null
          is_popular: boolean
          last_spotify_attempt_at: string | null
          match_status: Database["public"]["Enums"]["song_match_status"]
          range_high_midi: number | null
          range_low_midi: number | null
          release_year: number | null
          source_urls: string[] | null
          spotify_attempt_count: number
          spotify_track_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          artist: string
          created_at?: string
          dam_request_no?: string | null
          falsetto_max_midi?: number | null
          id?: string
          image_url_large?: string | null
          image_url_medium?: string | null
          image_url_small?: string | null
          is_popular?: boolean
          last_spotify_attempt_at?: string | null
          match_status?: Database["public"]["Enums"]["song_match_status"]
          range_high_midi?: number | null
          range_low_midi?: number | null
          release_year?: number | null
          source_urls?: string[] | null
          spotify_attempt_count?: number
          spotify_track_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          artist?: string
          created_at?: string
          dam_request_no?: string | null
          falsetto_max_midi?: number | null
          id?: string
          image_url_large?: string | null
          image_url_medium?: string | null
          image_url_small?: string | null
          is_popular?: boolean
          last_spotify_attempt_at?: string | null
          match_status?: Database["public"]["Enums"]["song_match_status"]
          range_high_midi?: number | null
          range_low_midi?: number | null
          release_year?: number | null
          source_urls?: string[] | null
          spotify_attempt_count?: number
          spotify_track_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_known_songs: {
        Row: {
          last_seen: string
          rank: number | null
          song_id: string
          source: string
          user_id: string
        }
        Insert: {
          last_seen?: string
          rank?: number | null
          song_id: string
          source: string
          user_id: string
        }
        Update: {
          last_seen?: string
          rank?: number | null
          song_id?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_known_songs_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "songs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_spotify_connections: {
        Row: {
          access_token: string
          connected_at: string
          expires_at: string
          last_synced_at: string | null
          refresh_token: string
          scopes: string[]
          spotify_display_name: string | null
          spotify_user_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          connected_at?: string
          expires_at: string
          last_synced_at?: string | null
          refresh_token: string
          scopes: string[]
          spotify_display_name?: string | null
          spotify_user_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          connected_at?: string
          expires_at?: string
          last_synced_at?: string | null
          refresh_token?: string
          scopes?: string[]
          spotify_display_name?: string | null
          spotify_user_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      user_voice_estimate: {
        Row: {
          comfortable_max_midi: number | null
          comfortable_min_midi: number | null
          easy_count: number | null
          falsetto_max_midi: number | null
          limit_max_midi: number | null
          limit_min_midi: number | null
          rated_count: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_unrated_songs: {
        Args: { p_limit?: number; p_popular_only?: boolean }
        Returns: {
          artist: string
          created_at: string
          dam_request_no: string | null
          falsetto_max_midi: number | null
          id: string
          image_url_large: string | null
          image_url_medium: string | null
          image_url_small: string | null
          is_popular: boolean
          last_spotify_attempt_at: string | null
          match_status: Database["public"]["Enums"]["song_match_status"]
          range_high_midi: number | null
          range_low_midi: number | null
          release_year: number | null
          source_urls: string[] | null
          spotify_attempt_count: number
          spotify_track_id: string | null
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "songs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_user_rating_stats: {
        Args: never
        Returns: {
          count: number
          rating: Database["public"]["Enums"]["rating_type"]
        }[]
      }
    }
    Enums: {
      rating_type: "hard" | "medium" | "easy" | "practicing"
      song_match_status:
        | "pending"
        | "matched"
        | "unmatched"
        | "no_spotify"
        | "external"
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
  public: {
    Enums: {
      rating_type: ["hard", "medium", "easy", "practicing"],
      song_match_status: [
        "pending",
        "matched",
        "unmatched",
        "no_spotify",
        "external",
      ],
    },
  },
} as const
