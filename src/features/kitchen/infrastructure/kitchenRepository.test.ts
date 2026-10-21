import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authenticatedDeliverySource,
  authenticatedKitchenSource,
  createDeviceDeliverySource,
  createDeviceKitchenSource,
} from './kitchenRepository'

const { rpc, channel, removeChannel, realtime, clientError } = vi.hoisted(() => {
  const realtime = {
    onBroadcast: null as null | ((message: unknown) => void),
    onStatus: null as null | ((status: string) => void),
  }
  const fakeChannel = {
    on: vi.fn((_type: string, _filter: unknown, handler: (message: unknown) => void) => {
      realtime.onBroadcast = handler
      return fakeChannel
    }),
    subscribe: vi.fn((callback: (status: string) => void) => {
      realtime.onStatus = callback
      return fakeChannel
    }),
  }
  return {
    rpc: vi.fn(),
    channel: vi.fn(() => fakeChannel),
    clientError: { current: null as Error | null },
    removeChannel: vi.fn().mockResolvedValue('ok'),
    realtime,
  }
})

vi.mock('../../../shared/supabase/client', () => ({
  getSupabaseClient: () => {
    if (clientError.current) throw clientError.current
    return { rpc, channel, removeChannel }
  },
}))

const row = {
  id: 'o1',
  token: 7,
  table_number: 3,
  customer_name: null,
  waiter_name: 'Luis',
  notes: 'sin prisa',
  created_at: '2026-10-10T10:00:00Z',
  lines: [
    { id: 'l1', product_name: 'Hamburguesa', quantity: 2, item_type: 'product', pizza: null, notes: null, variant: 'Res', station: 'grill' },
  ],
}

const mapped = {
  id: 'o1',
  token: 7,
  tableNumber: 3,
  customerName: null,
  waiterName: 'Luis',
  notes: 'sin prisa',
  createdAt: '2026-10-10T10:00:00Z',
  scheduledFor: null,
  lines: [
    { id: 'l1', productName: 'Hamburguesa', quantity: 2, type: 'product', pizza: null, notes: null, variant: 'Res', station: 'grill' },
  ],
}

beforeEach(() => rpc.mockReset())

describe('device kitchen source', () => {
  it('lists with the secret only and maps rows', async () => {
    rpc.mockResolvedValue({ data: [row], error: null })
    expect(await createDeviceKitchenSource('sec').listOrders()).toEqual([mapped])
    expect(rpc).toHaveBeenCalledWith('device_list_kitchen_orders', { p_device_secret: 'sec' })
  })

  it('maps scheduled_for to scheduledFor and a missing one to null', async () => {
    const scheduledFor = new Date(2026, 9, 21, 14, 30).toISOString()
    rpc.mockResolvedValue({ data: [{ ...row, scheduled_for: scheduledFor }, row], error: null })
    const orders = await createDeviceKitchenSource('sec').listOrders()
    expect(orders[0]!.scheduledFor).toBe(scheduledFor)
    expect(orders[1]!.scheduledFor).toBeNull()
  })

  it('maps a missing token to null', async () => {
    const { token: _token, ...withoutToken } = row
    rpc.mockResolvedValue({ data: [withoutToken], error: null })
    expect((await createDeviceKitchenSource('sec').listOrders())[0]!.token).toBeNull()
  })

  it('maps a missing line station to null', async () => {
    const lines = row.lines.map(({ station: _station, ...line }) => line)
    rpc.mockResolvedValue({ data: [{ ...row, lines }], error: null })
    expect((await createDeviceKitchenSource('sec').listOrders())[0]!.lines[0]!.station).toBeNull()
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
    await source.markDelivered('o1', ['l1'])
    expect(rpc).toHaveBeenCalledWith('device_mark_delivered', {
      p_device_secret: 'sec',
      p_shift_token: 'tok',
      p_order_id: 'o1',
      p_line_ids: ['l1'],
    })
  })

  it('device source requires a shift', async () => {
    const source = createDeviceDeliverySource('sec', () => null)
    await expect(source.listReadyOrders()).rejects.toThrow()
    await expect(source.markDelivered('o1', ['l1'])).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('authenticated source uses the plain rpcs', async () => {
    rpc.mockResolvedValue({ data: [row], error: null })
    expect(await authenticatedDeliverySource.listReadyOrders()).toEqual([mapped])
    expect(rpc).toHaveBeenCalledWith('list_ready_orders')

    rpc.mockResolvedValue({ data: { order_id: 'o1' }, error: null })
    await authenticatedDeliverySource.markDelivered('o1', ['l1'])
    expect(rpc).toHaveBeenCalledWith('mark_delivered', { p_order_id: 'o1', p_line_ids: ['l1'] })
  })
})

describe('subscribeKitchenChanges', () => {
  // The shared channel is module state: give every test a fresh module.
  let repo: typeof import('./kitchenRepository')
  let subscribeKitchenChanges: typeof repo.subscribeKitchenChanges

  beforeEach(async () => {
    channel.mockClear()
    removeChannel.mockClear()
    vi.resetModules()
    repo = await import('./kitchenRepository')
    subscribeKitchenChanges = repo.subscribeKitchenChanges
  })

  it('shares one public kitchen channel and notifies every listener on a change signal', () => {
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = subscribeKitchenChanges(first)
    const stopSecond = subscribeKitchenChanges(second)
    expect(channel).toHaveBeenCalledTimes(1)
    expect(channel).toHaveBeenCalledWith('kitchen')
    const fakeChannel = channel.mock.results[0]!.value
    expect(fakeChannel.on).toHaveBeenCalledWith('broadcast', { event: 'changed' }, expect.any(Function))

    realtime.onBroadcast!({ event: 'changed', payload: {} })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    stopFirst()
    realtime.onBroadcast!({ event: 'changed', payload: {} })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)

    stopSecond()
    realtime.onBroadcast!({ event: 'changed', payload: {} })
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('notifies when the channel (re)subscribes, but not on errors', () => {
    const listener = vi.fn()
    const stop = subscribeKitchenChanges(listener)
    realtime.onStatus!('CHANNEL_ERROR')
    realtime.onStatus!('TIMED_OUT')
    expect(listener).not.toHaveBeenCalled()
    realtime.onStatus!('SUBSCRIBED')
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
  })

  it('keeps the channel open for the next board after the last listener left', () => {
    // realtime-js returns the same (still leaving) channel for the topic, so removing and
    // re-creating it quickly would leave the next board on a dead channel.
    subscribeKitchenChanges(vi.fn())()
    const next = vi.fn()
    const stop = subscribeKitchenChanges(next)
    expect(channel).toHaveBeenCalledTimes(1)
    expect(removeChannel).not.toHaveBeenCalled()
    realtime.onBroadcast!({ event: 'changed', payload: {} })
    expect(next).toHaveBeenCalledTimes(1)
    stop()
  })

  it('does not keep the listener when the client cannot subscribe', () => {
    const failed = vi.fn()
    clientError.current = new Error('no configurada')
    try {
      expect(() => subscribeKitchenChanges(failed)).toThrow('no configurada')
    } finally {
      clientError.current = null
    }
    const stop = subscribeKitchenChanges(vi.fn())
    realtime.onBroadcast!({ event: 'changed', payload: {} })
    expect(failed).not.toHaveBeenCalled()
    stop()
  })

  it('is exposed by every kitchen and delivery source', () => {
    expect(repo.createDeviceKitchenSource('s').subscribe).toBe(subscribeKitchenChanges)
    expect(repo.authenticatedKitchenSource('pizza').subscribe).toBe(subscribeKitchenChanges)
    expect(repo.createDeviceDeliverySource('s', () => 't').subscribe).toBe(subscribeKitchenChanges)
    expect(repo.authenticatedDeliverySource.subscribe).toBe(subscribeKitchenChanges)
  })
})
