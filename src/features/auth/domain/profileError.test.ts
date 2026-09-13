import { describe, expect, it } from 'vitest'
import { toProfileErrorMessage } from './profileError'

describe('toProfileErrorMessage', () => {
  it('reports a missing profile row when there is no data and no error', () => {
    expect(toProfileErrorMessage(null, false)).toBe(
      'Tu usuario no tiene un perfil registrado. Un administrador debe crearlo (consulta la sección de usuarios del README).',
    )
  })

  it('reports a missing profile row for the PGRST116 single-row-not-found code', () => {
    const error = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }

    expect(toProfileErrorMessage(error, false)).toBe(
      'Tu usuario no tiene un perfil registrado. Un administrador debe crearlo (consulta la sección de usuarios del README).',
    )
  })

  it('reports an uninitialized database for the PGRST205 missing-table code', () => {
    const error = { code: 'PGRST205', message: 'Could not find the table' }

    expect(toProfileErrorMessage(error, false)).toBe(
      'La base de datos no está inicializada. Aplica la migración de Supabase.',
    )
  })

  it('reports an uninitialized database for the 42P01 missing-relation code', () => {
    const error = { code: '42P01', message: 'relation "public.profiles" does not exist' }

    expect(toProfileErrorMessage(error, false)).toBe(
      'La base de datos no está inicializada. Aplica la migración de Supabase.',
    )
  })

  it('includes the original message for any other error', () => {
    const error = { code: '42501', message: 'permission denied for table profiles' }

    expect(toProfileErrorMessage(error, false)).toBe(
      'No se pudo cargar el perfil del usuario: permission denied for table profiles',
    )
  })

  it('falls back to a generic sentence when the error has no message', () => {
    const error = { code: '42501', message: '' }

    expect(toProfileErrorMessage(error, false)).toBe(
      'No se pudo cargar el perfil del usuario: ocurrió un error desconocido.',
    )
  })
})
