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
      artists: {
        Row: {
          created_at: string
          genres: string[]
          id: string
          name: string
          name_norm: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          genres?: string[]
          id?: string
          name: string
          name_norm: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          genres?: string[]
          id?: string
          name?: string
          name_norm?: string
          updated_at?: string
        }
        Relationships: []
      }
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
          {
            foreignKeyName: "evaluations_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "songs_with_genres"
            referencedColumns: ["id"]
          },
        ]
      }
      friend_invite_links: {
        Row: {
          created_at: string
          creator_id: string
          expires_at: string
          token: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          expires_at: string
          token: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          expires_at?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "friend_invite_links_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          accepted_at: string | null
          created_at: string
          requested_by_id: string
          status: string
          user_a_id: string
          user_b_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          requested_by_id: string
          status: string
          user_a_id: string
          user_b_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          requested_by_id?: string
          status?: string
          user_a_id?: string
          user_b_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendships_requested_by_id_fkey"
            columns: ["requested_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_user_a_id_fkey"
            columns: ["user_a_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_user_b_id_fkey"
            columns: ["user_b_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      room_participants: {
        Row: {
          guest_name: string | null
          guest_token: string | null
          id: string
          joined_at: string
          left_at: string | null
          room_id: string
          user_id: string | null
        }
        Insert: {
          guest_name?: string | null
          guest_token?: string | null
          id?: string
          joined_at?: string
          left_at?: string | null
          room_id: string
          user_id?: string | null
        }
        Update: {
          guest_name?: string | null
          guest_token?: string | null
          id?: string
          joined_at?: string
          left_at?: string | null
          room_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_participants_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          created_at: string
          creator_id: string
          ended_at: string | null
          id: string
          last_activity_at: string
          qr_expires_at: string
          qr_token: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          ended_at?: string | null
          id?: string
          last_activity_at?: string
          qr_expires_at: string
          qr_token: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          ended_at?: string | null
          id?: string
          last_activity_at?: string
          qr_expires_at?: string
          qr_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      songs: {
        Row: {
          artist: string
          artist_id: string | null
          created_at: string
          dam_request_no: string | null
          duration_ms: number | null
          falsetto_max_midi: number | null
          fame_article: string | null
          fame_score: number | null
          fame_updated_at: string | null
          fame_views: number | null
          genres: string[] | null
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
          artist_id?: string | null
          created_at?: string
          dam_request_no?: string | null
          duration_ms?: number | null
          falsetto_max_midi?: number | null
          fame_article?: string | null
          fame_score?: number | null
          fame_updated_at?: string | null
          fame_views?: number | null
          genres?: string[] | null
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
          artist_id?: string | null
          created_at?: string
          dam_request_no?: string | null
          duration_ms?: number | null
          falsetto_max_midi?: number | null
          fame_article?: string | null
          fame_score?: number | null
          fame_updated_at?: string | null
          fame_views?: number | null
          genres?: string[] | null
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
        Relationships: [
          {
            foreignKeyName: "songs_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "songs_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists_with_song_count"
            referencedColumns: ["id"]
          },
        ]
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
          {
            foreignKeyName: "user_known_songs_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "songs_with_genres"
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
      artists_with_song_count: {
        Row: {
          created_at: string | null
          genres: string[] | null
          id: string | null
          is_labeled: boolean | null
          name: string | null
          name_norm: string | null
          song_count: number | null
          updated_at: string | null
        }
        Relationships: []
      }
      songs_with_genres: {
        Row: {
          artist: string | null
          artist_id: string | null
          artist_name_canonical: string | null
          created_at: string | null
          dam_request_no: string | null
          effective_genres: string[] | null
          falsetto_max_midi: number | null
          genres: string[] | null
          id: string | null
          image_url_large: string | null
          image_url_medium: string | null
          image_url_small: string | null
          is_popular: boolean | null
          last_spotify_attempt_at: string | null
          match_status: Database["public"]["Enums"]["song_match_status"] | null
          range_high_midi: number | null
          range_low_midi: number | null
          release_year: number | null
          source_urls: string[] | null
          spotify_attempt_count: number | null
          spotify_track_id: string | null
          title: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "songs_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "songs_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists_with_song_count"
            referencedColumns: ["id"]
          },
        ]
      }
      user_genre_distribution: {
        Row: {
          genre: string | null
          song_count: number | null
          user_id: string | null
        }
        Relationships: []
      }
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
      accept_friend_invite: {
        Args: { p_token: string }
        Returns: {
          friend_id: string
          status: string
        }[]
      }
      auto_end_idle_rooms: { Args: never; Returns: undefined }
      cleanup_expired_invite_links: { Args: never; Returns: undefined }
      cleanup_old_rooms: { Args: never; Returns: undefined }
      get_friend_active_rooms: {
        Args: never
        Returns: {
          created_at: string
          creator_id: string
          creator_name: string
          participant_count: number
          qr_expires_at: string
          qr_token: string
          room_id: string
        }[]
      }
      get_friend_invite_info: {
        Args: { p_token: string }
        Returns: {
          creator_id: string
          creator_name: string
          expires_at: string
          is_valid: boolean
        }[]
      }
      get_unrated_songs: {
        Args: { p_limit?: number; p_popular_only?: boolean }
        Returns: {
          artist: string
          artist_id: string | null
          created_at: string
          dam_request_no: string | null
          falsetto_max_midi: number | null
          fame_article: string | null
          fame_score: number | null
          fame_updated_at: string | null
          fame_views: number | null
          genres: string[] | null
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
      get_unrated_songs_v2: {
        Args: { p_limit?: number; p_popular_only?: boolean }
        Returns: {
          artist: string
          artist_id: string | null
          created_at: string
          dam_request_no: string | null
          falsetto_max_midi: number | null
          fame_article: string | null
          fame_score: number | null
          fame_updated_at: string | null
          fame_views: number | null
          genres: string[] | null
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
      is_room_participant: {
        Args: { p_room_id: string; p_user_id: string }
        Returns: boolean
      }
      join_room_by_qr: {
        Args: {
          p_guest_name?: string
          p_guest_token?: string
          p_qr_token: string
        }
        Returns: {
          guest_token: string
          participant_id: string
          room_id: string
          status: string
        }[]
      }
      normalize_artist_name: { Args: { name: string }; Returns: string }
      search_songs_and_artists: {
        Args: {
          p_q: string
          p_high_min_midi?: number | null
          p_high_max_midi?: number | null
          p_artist_limit?: number | null
          p_song_limit?: number | null
        }
        Returns: Json
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
