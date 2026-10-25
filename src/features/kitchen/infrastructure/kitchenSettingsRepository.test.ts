import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchKitchenEnabled, setKitchenEnabled } from './kitchenSettingsRepository'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../../shared/supabase/client', () => ({
  getSupabaseClient: () => ({ rpc }),
}))

beforeEach(() => {
  vi.resetAllMocks()
})

describe('kitchenSettingsRepository', () => {
  it('reads the kitchen switch', async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    await expect(fetchKitchenEnabled()).resolves.toBe(false)
    expect(rpc).toHaveBeenCalledWith('kitchen_enabled')
  })

  it('changes the kitchen switch', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    await expect(setKitchenEnabled(true)).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith('set_kitchen_enabled', { p_enabled: true })
  })

  it('surfaces the server message', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Solo un administrador puede activar o desactivar la cocina.' } })
    await expect(setKitchenEnabled(false)).rejects.toThrow('Solo un administrador puede activar o desactivar la cocina.')
  })

  it('rejects an unexpected payload', async () => {
    rpc.mockResolvedValue({ data: 'yes', error: null })
    await expect(fetchKitchenEnabled()).rejects.toThrow('No se pudo cargar el estado de la cocina.')
  })
})
