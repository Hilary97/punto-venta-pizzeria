import type { PostgrestError } from '@supabase/supabase-js'

/** Fields of a Supabase PostgREST error this mapper reads. */
export type ProfileError = Pick<PostgrestError, 'code' | 'message'>

/**
 * Maps the result of the "own profile" query to a user-facing Spanish
 * message. `hasProfile` should be `true` only when the query returned a row.
 */
export function toProfileErrorMessage(error: ProfileError | null, hasProfile: boolean): string {
  if (error?.code === 'PGRST116') {
    return 'Tu usuario no tiene un perfil registrado. Un administrador debe crearlo (consulta la sección de usuarios del README).'
  }
  if (error?.code === 'PGRST205' || error?.code === '42P01') {
    return 'La base de datos no está inicializada. Aplica la migración de Supabase.'
  }
  if (error) {
    return `No se pudo cargar el perfil del usuario: ${error.message || 'ocurrió un error desconocido.'}`
  }
  if (!hasProfile) {
    return 'Tu usuario no tiene un perfil registrado. Un administrador debe crearlo (consulta la sección de usuarios del README).'
  }
  return 'No se pudo cargar el perfil del usuario.'
}
