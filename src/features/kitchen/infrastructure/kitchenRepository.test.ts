import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authenticatedDeliverySource,
  authenticatedKitchenSource,
  createDeviceDeliverySource,
  createDeviceKitchenSource,
} from './kitchenRepository'

const rpc = vi.hoisted(() => vi.fn())

vi.mock('../../../shared/supabase/client', () => ({
  getSupabaseClient: () => ({ rpc }),
}))

const row = {
  id: 'o1',
  table_number: 3,
  customer_name: null,
  waiter_name: 'Luis',
  notes: 'sin prisa',
  created_at: '2026-10-10T10:00:00Z',
  lines: [
    { id: 'l1', product_name: 'Hamburguesa', quantity: 2, item_type: 'product', pizza: null, notes: null, variant: 'Res' },
  ],
}

const mapped = {
  id: 'o1',
  tableNumber: 3,
  customerName: null,
  waiterName: 'Luis',
  notes: 'sin prisa',
  createdAt: '2026-10-10T10:00:00Z',
  lines: [
    { id: 'l1', productName: 'Hamburguesa', quantity: 2, type: 'product', pizza: null, notes: null, variant: 'Res' },
  ],
}

beforeEach(() => rpc.mockReset())

describe('device kitchen source', () => {
  it('lists with the secret only and maps rows', async () => {
    rpc.mockResolvedValue({ data: [row], error: null })
    expect(await createDeviceKitchenSource('sec').listOrders()).toEqual([mapped])
    expect(rpc).toHaveBeenCalledWith('device_list_kitchen_orders', { p_device_secret: 'sec' })
  })

  it('marks ready', async () => {
    rpc.mockResolvedValue({ data: { order_id: 'o1' }, error: null })
    await createDeviceKitchenSource('sec').markReady('o1', ['l1', 'l2'])
    expect(rpc).toHaveBeenCalledWith('device_mark_station_ready', {
      p_device_secret: 'sec',
      p_order_id: 'o1',
      p_line_ids: ['l1', 'l2'],
    })
  })

  it('rejects malformed payloads and rpc errors', async () => {
    rpc.mockResolvedValue({ data: [{ id: 1 }], error: null })
    await expect(createDeviceKitchenSource('sec').listOrders()).rejects.toThrow()
    rpc.mockResolvedValue({ data: null, error: { message: 'Este dispositivo no es de cocina.' } })
    await expect(createDeviceKitchenSource('sec').markReady('o1', ['l1'])).rejects.toThrow('no es de cocina')
  })

  it('treats a station with no pending lines as empty lines', async () => {
    rpc.mockResolvedValue({ data: [{ ...row, lines: null }], error: null })
    expect((await createDeviceKitchenSource('sec').listOrders())[0]?.lines).toEqual([])
  })
})

describe('authenticated kitchen source', () => {
  it('passes the station', async () => {
    rpc.mockResolvedValue({ data: [row], error: null })
    expect(await authenticatedKitchenSource('grill').listOrders()).toEqual([mapped])
    expect(rpc).toHaveBeenCalledWith('list_kitchen_orders', { p_station: 'grill' })

    rpc.mockResolvedValue({ data: { order_id: 'o1' }, error: null })
    await authenticatedKitchenSource('pizza').markReady('o1', ['l1'])
    expect(rpc).toHaveBeenCalledWith('mark_station_ready', {
      p_order_id: 'o1',
      p_station: 'pizza',
      p_line_ids: ['l1'],
    })
  })
})

describe('delivery sources', () => {
  it('device source sends secret and shift token', async () => {
    rpc.mockResolvedValue({ data: [row], error: null })
    const source = createDeviceDeliverySource('sec', () => 'tok')
    expect(await source.listReadyOrders()).toEqual([mapped])
    expect(rpc).toHaveBeenCalledWith('device_list_ready_orders', { p_device_secret: 'sec', p_shift_token: 'tok' })

    rpc.mockResolvedValue({ data: { order_id: 'o1' }, error: null })
    await source.markDelivered('o1')
    expect(rpc).toHaveBeenCalledWith('device_mark_delivered', {
      p_device_secret: 'sec',
      p_shift_token: 'tok',
      p_order_id: 'o1',
    })
  })

  it('device source requires a shift', async () => {
    const source = createDeviceDeliverySource('sec', () => null)
    await expect(source.listReadyOrders()).rejects.toThrow()
    await expect(source.markDelivered('o1')).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('authenticated source uses the plain rpcs', async () => {
    rpc.mockResolvedValue({ data: [row], error: null })
    expect(await authenticatedDeliverySource.listReadyOrders()).toEqual([mapped])
    expect(rpc).toHaveBeenCalledWith('list_ready_orders')

    rpc.mockResolvedValue({ data: { order_id: 'o1' }, error: null })
    await authenticatedDeliverySource.markDelivered('o1')
    expect(rpc).toHaveBeenCalledWith('mark_delivered', { p_order_id: 'o1' })
  })
})
