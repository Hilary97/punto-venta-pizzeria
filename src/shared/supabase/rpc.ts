import type { z } from 'zod'
import type { PostgrestError } from '@supabase/supabase-js'

/**
 * Validates the JSON payload returned by a security-definer RPC against a
 * Zod schema. RPCs raise `EXCEPTION 'message'` for business-rule failures
 * (e.g. insufficient payment, no open session), which supabase-js surfaces
 * as `error.message` already in Spanish from the SQL side; this only
 * covers transport failures and unexpected payload shapes.
 */
export function parseRpcResult<T>(
  schema: z.ZodType<T>,
  data: unknown,
  error: PostgrestError | null,
  fallbackMessage: string,
): T {
  if (error) {
    throw new Error(error.message || fallbackMessage)
  }

  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new Error(fallbackMessage)
  }

  return parsed.data
}
