/**
 * Generated from the live schema — do not hand-edit.
 * Regenerate after every migration.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          owner_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          owner_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      event_versions: {
        Row: {
          created_at: string
          event_id: string
          id: string
          owner_id: string
          reason: string
          snapshot: Json
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          owner_id: string
          reason: string
          snapshot: Json
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          owner_id?: string
          reason?: string
          snapshot?: Json
        }
        // Deliberately none: `event_id` is not a foreign key, so a version
        // outlives the row it describes. See the migration.
        Relationships: []
      }
      events: {
        Row: {
          all_day: boolean
          anchor_date: string | null
          category_id: string | null
          created_at: string
          deleted_at: string | null
          display_template: string | null
          end_date: string | null
          ends_at: string | null
          google_calendar_id: string | null
          google_event_id: string | null
          google_sync_hash: string | null
          google_synced_at: string | null
          id: string
          kind: Database["public"]["Enums"]["event_kind"]
          notes: string | null
          notify: boolean
          owner_id: string
          recurrence: Json | null
          reminders: Json | null
          source: Database["public"]["Enums"]["event_source"]
          start_date: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["event_status"] | null
          timezone: string
          title: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          anchor_date?: string | null
          category_id?: string | null
          created_at?: string
          deleted_at?: string | null
          display_template?: string | null
          end_date?: string | null
          ends_at?: string | null
          google_calendar_id?: string | null
          google_event_id?: string | null
          google_sync_hash?: string | null
          google_synced_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["event_kind"]
          notes?: string | null
          notify?: boolean
          owner_id: string
          recurrence?: Json | null
          reminders?: Json | null
          source?: Database["public"]["Enums"]["event_source"]
          start_date?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["event_status"] | null
          timezone?: string
          title: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          anchor_date?: string | null
          category_id?: string | null
          created_at?: string
          deleted_at?: string | null
          display_template?: string | null
          end_date?: string | null
          ends_at?: string | null
          google_calendar_id?: string | null
          google_event_id?: string | null
          google_sync_hash?: string | null
          google_synced_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["event_kind"]
          notes?: string | null
          notify?: boolean
          owner_id?: string
          recurrence?: Json | null
          reminders?: Json | null
          source?: Database["public"]["Enums"]["event_source"]
          start_date?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["event_status"] | null
          timezone?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      google_events_cache: {
        Row: {
          all_day: boolean
          calendar_id: string
          end_date: string | null
          ends_at: string | null
          etag: string | null
          html_link: string | null
          id: string
          owner_id: string
          raw: Json | null
          start_date: string | null
          starts_at: string | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          calendar_id: string
          end_date?: string | null
          ends_at?: string | null
          etag?: string | null
          html_link?: string | null
          id: string
          owner_id: string
          raw?: Json | null
          start_date?: string | null
          starts_at?: string | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          calendar_id?: string
          end_date?: string | null
          ends_at?: string | null
          etag?: string | null
          html_link?: string | null
          id?: string
          owner_id?: string
          raw?: Json | null
          start_date?: string | null
          starts_at?: string | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      integrations: {
        Row: {
          access_token: string | null
          calendar_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          owner_id: string
          provider: string
          refresh_token: string | null
          scope: string | null
          sync_token: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          calendar_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          owner_id: string
          provider?: string
          refresh_token?: string | null
          scope?: string | null
          sync_token?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          calendar_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          owner_id?: string
          provider?: string
          refresh_token?: string | null
          scope?: string | null
          sync_token?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      occurrence_overrides: {
        Row: {
          cancelled: boolean
          created_at: string
          event_id: string
          id: string
          occurrence_date: string
          owner_id: string
          patch: Json
          updated_at: string
        }
        Insert: {
          cancelled?: boolean
          created_at?: string
          event_id: string
          id?: string
          occurrence_date: string
          owner_id: string
          patch?: Json
          updated_at?: string
        }
        Update: {
          cancelled?: boolean
          created_at?: string
          event_id?: string
          id?: string
          occurrence_date?: string
          owner_id?: string
          patch?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_overrides_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failure_count: number
          id: string
          last_seen_at: string
          owner_id: string
          p256dh: string
          user_agent: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failure_count?: number
          id?: string
          last_seen_at?: string
          owner_id: string
          p256dh: string
          user_agent?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failure_count?: number
          id?: string
          last_seen_at?: string
          owner_id?: string
          p256dh?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      reminder_deliveries: {
        Row: {
          event_id: string
          fire_at: string
          id: string
          minutes: number
          occurrence_date: string
          owner_id: string
          sent_at: string
        }
        Insert: {
          event_id: string
          fire_at: string
          id?: string
          minutes: number
          occurrence_date: string
          owner_id: string
          sent_at?: string
        }
        Update: {
          event_id?: string
          fire_at?: string
          id?: string
          minutes?: number
          occurrence_date?: string
          owner_id?: string
          sent_at?: string
        }
        // Deliberately none, like `event_versions`: a delivery record has to
        // outlive a hard-deleted event. See the migration.
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      event_kind: "event" | "assignment" | "milestone" | "birthday"
      event_source: "tempo" | "google"
      event_status: "todo" | "doing" | "done"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database['public']

export type EventRow = PublicSchema['Tables']['events']['Row']
export type EventInsert = PublicSchema['Tables']['events']['Insert']
export type EventUpdate = PublicSchema['Tables']['events']['Update']
export type CategoryRow = PublicSchema['Tables']['categories']['Row']
export type OccurrenceOverrideRow = PublicSchema['Tables']['occurrence_overrides']['Row']
export type EventVersionRow = PublicSchema['Tables']['event_versions']['Row']
export type EventVersionInsert = PublicSchema['Tables']['event_versions']['Insert']
export type GoogleEventCacheRow = PublicSchema['Tables']['google_events_cache']['Row']
export type IntegrationRow = PublicSchema['Tables']['integrations']['Row']
export type PushSubscriptionRow = PublicSchema['Tables']['push_subscriptions']['Row']

export type EventKindDb = PublicSchema['Enums']['event_kind']
export type EventStatusDb = PublicSchema['Enums']['event_status']
export type EventSourceDb = PublicSchema['Enums']['event_source']
