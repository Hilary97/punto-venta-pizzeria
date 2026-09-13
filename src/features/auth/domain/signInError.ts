import type { AuthError } from '@supabase/supabase-js'

/** Fields of a Supabase auth error this mapper reads. */
export type SignInError = Pick<AuthError, 'code' | 'status' | 'name' | 'message'>

/** Maps a Supabase `signInWithPassword` error to a user-facing Spanish message. */
export function toSignInErrorMessage(error: SignInError): string {
  if (error.code === 'invalid_credentials') {
    return 'Correo o contraseña incorrectos.'
  }
  if (error.code === 'email_not_confirmed') {
    return 'Tu correo aún no está confirmado. Confírmalo desde el enlace que recibiste o marca el usuario como confirmado en Supabase.'
  }
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) {
    return 'No se pudo conectar con el servidor. Revisa tu conexión a internet.'
  }
  if (error.status === 404) {
    return 'No se encontró el servicio de inicio de sesión. Revisa que VITE_SUPABASE_URL sea la URL base del proyecto, sin /rest/v1/ al final.'
  }
  if (error.code === 'over_request_rate_limit' || error.status === 429) {
    return 'Demasiados intentos. Espera un momento y vuelve a intentarlo.'
  }
  return `No se pudo iniciar sesión: ${error.message || 'ocurrió un error desconocido.'}`
}
