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

export type UserRole = 'admin' | 'cashier' | 'waiter'
export type OrderStatus = 'open' | 'paid' | 'cancelled'

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
      orders: EmptyRelationships & {
        Row: {
          id: string
          table_number: number | null
          customer_name: string | null
          status: OrderStatus
          created_by: string
          created_at: string
          paid_sale_id: string | null
          paid_at: string | null
          cancelled_at: string | null
          waiter_id: string | null
          waiter_name: string | null
        }
        Insert: never
        Update: never
      }
      order_items: EmptyRelationships & {
        Row: {
          id: string
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
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
      delete_closed_cash_session: {
        Args: { p_session_id: string }
        Returns: unknown
      }
      close_cash_session: {
        Args: { p_counted_cents: number }
        Returns: unknown
      }
      create_order: {
        Args: {
          p_table_number: number | null
          p_customer_name: string | null
          p_items: unknown
        }
        Returns: unknown
      }
      admin_list_waiters: { Args: Record<string, never>; Returns: unknown }
      admin_create_waiter: { Args: { p_full_name: string; p_pin: string }; Returns: unknown }
      admin_update_waiter: {
        Args: { p_waiter_id: string; p_full_name: string; p_active: boolean }
        Returns: unknown
      }
      admin_reset_waiter_pin: { Args: { p_waiter_id: string; p_pin: string }; Returns: unknown }
      admin_unlock_waiter: { Args: { p_waiter_id: string }; Returns: unknown }
      admin_register_device: { Args: { p_name: string }; Returns: unknown }
      admin_list_devices: { Args: Record<string, never>; Returns: unknown }
      admin_revoke_device: { Args: { p_device_id: string }; Returns: unknown }
      admin_delete_waiter: { Args: { p_waiter_id: string }; Returns: unknown }
      admin_delete_device: { Args: { p_device_id: string }; Returns: unknown }
      device_info: { Args: { p_device_secret: string }; Returns: unknown }
      device_list_waiters: { Args: { p_device_secret: string }; Returns: unknown }
      device_start_shift: {
        Args: { p_device_secret: string; p_waiter_id: string; p_pin: string }
        Returns: unknown
      }
      device_get_shift: {
        Args: { p_device_secret: string; p_shift_token: string }
        Returns: unknown
      }
      device_end_shift: {
        Args: { p_device_secret: string; p_shift_token: string }
        Returns: unknown
      }
      device_list_catalog: { Args: { p_device_secret: string }; Returns: unknown }
      device_list_open_orders: { Args: { p_device_secret: string }; Returns: unknown }
      device_create_order: {
        Args: {
          p_device_secret: string
          p_shift_token: string
          p_table_number: number | null
          p_customer_name: string | null
          p_items: unknown
        }
        Returns: unknown
      }
      device_add_order_items: {
        Args: {
          p_device_secret: string
          p_shift_token: string
          p_order_id: string
          p_items: unknown
        }
        Returns: unknown
      }
      device_cancel_order: {
        Args: { p_device_secret: string; p_shift_token: string; p_order_id: string }
        Returns: unknown
      }
      add_order_items: {
        Args: { p_order_id: string; p_items: unknown }
        Returns: unknown
      }
      cancel_order: {
        Args: { p_order_id: string }
        Returns: unknown
      }
      pay_order: {
        Args: { p_order_id: string; p_received_cents: number }
        Returns: unknown
      }
    }
  }
}
