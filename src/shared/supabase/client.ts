import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True when both required Supabase env vars are present and non-empty. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

let client: SupabaseClient<Database> | null = null

if (isSupabaseConfigured) {
  client = createClient<Database>(supabaseUrl, supabaseAnonKey)
}

/**
 * Returns the shared Supabase client. Throws a clear, Spanish, user-facing
 * error if the app was started without the required environment variables
 * instead of failing with a cryptic network error deep in a repository call.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (!client) {
    throw new Error(
      'La aplicación no está configurada: faltan las variables de entorno VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY.',
    )
  }
  return client
}
