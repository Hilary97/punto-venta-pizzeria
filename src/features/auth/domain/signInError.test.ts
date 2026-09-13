import { describe, expect, it } from 'vitest'
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { toSignInErrorMessage } from './signInError'

describe('toSignInErrorMessage', () => {
  it('maps invalid_credentials to a wrong email/password message', () => {
    const error = new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')

    expect(toSignInErrorMessage(error)).toBe('Correo o contraseña incorrectos.')
  })

  it('maps email_not_confirmed to a confirmation-needed message', () => {
    const error = new AuthApiError('Email not confirmed', 400, 'email_not_confirmed')

    expect(toSignInErrorMessage(error)).toBe(
      'Tu correo aún no está confirmado. Confírmalo desde el enlace que recibiste o marca el usuario como confirmado en Supabase.',
    )
  })

  it('maps a retryable fetch error to a connectivity message', () => {
    const error = new AuthRetryableFetchError('Failed to fetch', 0)

    expect(toSignInErrorMessage(error)).toBe(
      'No se pudo conectar con el servidor. Revisa tu conexión a internet.',
    )
  })

  it('maps a status 0 error without the retryable name to a connectivity message', () => {
    const error = new AuthApiError('Network error', 0, undefined)

    expect(toSignInErrorMessage(error)).toBe(
      'No se pudo conectar con el servidor. Revisa tu conexión a internet.',
    )
  })

  it('maps a 404 status to a misconfigured-URL message', () => {
    const error = new AuthApiError('Not Found', 404, undefined)

    expect(toSignInErrorMessage(error)).toBe(
      'No se encontró el servicio de inicio de sesión. Revisa que VITE_SUPABASE_URL sea la URL base del proyecto, sin /rest/v1/ al final.',
    )
  })

  it('maps over_request_rate_limit to a rate-limit message', () => {
    const error = new AuthApiError('Rate limit', 429, 'over_request_rate_limit')

    expect(toSignInErrorMessage(error)).toBe(
      'Demasiados intentos. Espera un momento y vuelve a intentarlo.',
    )
  })

  it('maps a 429 status without the rate-limit code to a rate-limit message', () => {
    const error = new AuthApiError('Too Many Requests', 429, undefined)

    expect(toSignInErrorMessage(error)).toBe(
      'Demasiados intentos. Espera un momento y vuelve a intentarlo.',
    )
  })

  it('falls back to a message that includes the original error text', () => {
    const error = new AuthApiError('Something unexpected happened', 500, 'unexpected_failure')

    expect(toSignInErrorMessage(error)).toBe(
      'No se pudo iniciar sesión: Something unexpected happened',
    )
  })

  it('falls back to a generic sentence when the error has no message', () => {
    const error = new AuthApiError('', 500, undefined)

    expect(toSignInErrorMessage(error)).toBe('No se pudo iniciar sesión: ocurrió un error desconocido.')
  })
})
