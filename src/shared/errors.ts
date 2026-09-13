/**
 * Maps a Supabase/RPC error (or any thrown value) to a user-facing Spanish
 * message. Postgres RPCs raise `EXCEPTION 'message'`, which Supabase
 * surfaces as `error.message`, so most backend validation errors already
 * arrive in readable form; this only adds a fallback for the rest.
 */
export function toUserMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return 'Ocurrió un error inesperado. Intenta de nuevo.'
}
