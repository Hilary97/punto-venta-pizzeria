import { expect, it, vi } from 'vitest'
import { signOut } from './authRepository'

const logout = vi.hoisted(() => vi.fn())
vi.mock('../../../shared/supabase/client', () => ({
  getSupabaseClient: () => ({ auth: { signOut: logout } }),
}))
it('rejects returned SDK logout errors with a Spanish recovery message', async () => {
  logout.mockResolvedValue({ error: new Error('network') })
  await expect(signOut()).rejects.toThrow('No se pudo cerrar la sesión. Intenta de nuevo.')
})
it('normalizes rejected SDK logout errors', async () => {
  logout.mockRejectedValue(new Error('network'))
  await expect(signOut()).rejects.toThrow('No se pudo cerrar la sesión. Intenta de nuevo.')
})
it('resolves successful logout', async () => {
  logout.mockResolvedValue({ error: null })
  await expect(signOut()).resolves.toBeUndefined()
})
