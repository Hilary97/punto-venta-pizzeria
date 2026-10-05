import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adminListDevices, adminRegisterDevice, deviceInfo } from './waitersRepository'

const rpc = vi.hoisted(() => vi.fn())

vi.mock('../../../shared/supabase/client', () => ({
  getSupabaseClient: () => ({ rpc }),
}))

beforeEach(() => rpc.mockReset())

describe('device kind', () => {
  it('deviceInfo returns the kind and defaults to waiter', async () => {
    rpc.mockResolvedValue({ data: { device_id: 'd', name: 'N', kind: 'kitchen_grill' }, error: null })
    expect(await deviceInfo('s')).toEqual({ deviceId: 'd', name: 'N', kind: 'kitchen_grill' })

    rpc.mockResolvedValue({ data: { device_id: 'd', name: 'N' }, error: null })
    expect((await deviceInfo('s')).kind).toBe('waiter')
  })

  it('adminListDevices maps kind with a waiter default', async () => {
    rpc.mockResolvedValue({
      data: [
        { id: '1', name: 'A', kind: 'kitchen_pizza', created_at: 'c', last_seen_at: null, revoked: false },
        { id: '2', name: 'B', created_at: 'c', last_seen_at: null, revoked: false },
      ],
      error: null,
    })
    const devices = await adminListDevices()
    expect(devices.map((d) => d.kind)).toEqual(['kitchen_pizza', 'waiter'])
  })

  it('adminRegisterDevice sends p_kind (default waiter) and returns the kind', async () => {
    rpc.mockResolvedValue({
      data: { device_id: 'd', name: 'N', kind: 'kitchen_pizza', device_secret: 'x'.repeat(64) },
      error: null,
    })
    const device = await adminRegisterDevice('N', 'kitchen_pizza')
    expect(rpc).toHaveBeenCalledWith('admin_register_device', { p_name: 'N', p_kind: 'kitchen_pizza' })
    expect(device.kind).toBe('kitchen_pizza')

    await adminRegisterDevice('N')
    expect(rpc).toHaveBeenLastCalledWith('admin_register_device', { p_name: 'N', p_kind: 'waiter' })
  })
})
