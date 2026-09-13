/**
 * Hand-written Supabase database types.
 *
 * These were written by hand to match `supabase/migrations/*_init.sql`
 * because the Supabase CLI (`supabase gen types typescript`) is not
 * available in this environment. If the schema changes, update this file
 * and the migration together, or regenerate it once the CLI is available:
 *   npx supabase gen types typescript --project-id <id> > src/shared/supabase/database.types.ts
 *
 * RPC results are typed as `unknown` here on purpose: the repositories that
 * call `.rpc(...)` validate the returned JSON with a Zod schema before
 * trusting its shape, so no `any` is needed and a malformed server response
 * fails loudly instead of silently.
 */

export type UserRole = 'admin' | 'cashier'

interface EmptyRelationships {
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      profiles: EmptyRelationships & {
        Row: {
          id: string
          full_name: string
          role: UserRole
          created_at: string
        }
        Insert: {
          id: string
          full_name?: string
          role?: UserRole
        }
        Update: {
          full_name?: string
          role?: UserRole
        }
      }
      categories: EmptyRelationships & {
        Row: {
          id: string
          name: string
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          name?: string
          sort_order?: number
        }
      }
      products: EmptyRelationships & {
        Row: {
          id: string
          category_id: string
          name: string
          price_cents: number
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          category_id: string
          name: string
          price_cents: number
          active?: boolean
        }
        Update: {
          category_id?: string
          name?: string
          price_cents?: number
          active?: boolean
        }
      }
      cash_sessions: EmptyRelationships & {
        Row: {
          id: string
          opened_by: string
          opened_at: string
          opening_cents: number
          closed_by: string | null
          closed_at: string | null
          counted_cents: number | null
          expected_cents: number | null
          difference_cents: number | null
        }
        Insert: never
        Update: never
      }
      sales: EmptyRelationships & {
        Row: {
          id: string
          session_id: string
          cashier_id: string
          total_cents: number
          received_cents: number
          change_cents: number
          created_at: string
        }
        Insert: never
        Update: never
      }
      sale_items: EmptyRelationships & {
        Row: {
          id: string
          sale_id: string
          product_id: string | null
          product_name: string
          unit_price_cents: number
          quantity: number
        }
        Insert: never
        Update: never
      }
      returns: EmptyRelationships & {
        Row: {
          id: string
          session_id: string
          sale_id: string
          cashier_id: string
          reason: string | null
          total_cents: number
          created_at: string
        }
        Insert: never
        Update: never
      }
      return_items: EmptyRelationships & {
        Row: {
          id: string
          return_id: string
          sale_item_id: string
          quantity: number
          amount_cents: number
        }
        Insert: never
        Update: never
      }
    }
    Views: Record<string, never>
    Functions: {
      open_cash_session: {
        Args: { p_opening_cents: number }
        Returns: unknown
      }
      create_sale: {
        Args: { p_items: unknown; p_received_cents: number }
        Returns: unknown
      }
      create_return: {
        Args: { p_sale_id: string; p_items: unknown; p_reason: string | null }
        Returns: unknown
      }
      get_cash_summary: {
        Args: { p_session_id: string }
        Returns: unknown
      }
      close_cash_session: {
        Args: { p_counted_cents: number }
        Returns: unknown
      }
    }
  }
}
