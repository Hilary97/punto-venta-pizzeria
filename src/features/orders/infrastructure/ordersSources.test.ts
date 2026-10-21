import { describe, expect, it, vi } from 'vitest'
import { subscribeKitchenChanges } from '../../kitchen/infrastructure/kitchenRepository'
import { authenticatedOrdersSource, createDeviceOrdersSource } from './ordersSources'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../../shared/supabase/client', () => ({ getSupabaseClient: () => ({ rpc }) }))

describe('orders sources', () => {
  it('expose the realtime order-change signal', () => {
    expect(authenticatedOrdersSource.subscribe).toBe(subscribeKitchenChanges)
    expect(createDeviceOrdersSource('s', () => 't').subscribe).toBe(subscribeKitchenChanges)
  })
})

describe('device catalog', () => {
  it('maps stock tracking per product, untracked when the rpc omits it', async () => {
    rpc.mockResolvedValue({
      data: {
        categories: [],
        products: [
          { id: 'soda', name: 'Refresco', category_id: 'c', variants: [], track_stock: true, stock: 3 },
          { id: 'old', name: 'Pizza', category_id: 'c', variants: [] },
        ],
        pizza: { sizes: [], styles: [], ingredients: [] },
      },
      error: null,
    })
    const catalog = await createDeviceOrdersSource('s', () => 't').loadCatalog()
    expect(catalog.products[0]).toMatchObject({ id: 'soda', trackStock: true, stock: 3 })
    expect(catalog.products[1]).toMatchObject({ id: 'old', trackStock: false, stock: 0 })
  })
})

describe('creating orders', () => {
  const items = [{ type: 'product' as const, productId: 'p', quantity: 1 }]

  it('sends the pickup time only when there is one', async () => {
    rpc.mockResolvedValue({ data: { order_id: 'o' }, error: null })
    const device = createDeviceOrdersSource('s', () => 't')

    await device.createOrder(2, null, items, null, '2026-10-21T20:30:00.000Z')
    expect(rpc).toHaveBeenLastCalledWith('device_create_order', expect.objectContaining({ p_scheduled_for: '2026-10-21T20:30:00.000Z' }))

    await device.createOrder(2, null, items, null)
    expect(rpc.mock.lastCall![1]).not.toHaveProperty('p_scheduled_for')

    await authenticatedOrdersSource.createOrder(2, null, items, null, '2026-10-21T20:30:00.000Z')
    expect(rpc).toHaveBeenLastCalledWith('create_order', expect.objectContaining({ p_scheduled_for: '2026-10-21T20:30:00.000Z' }))

    await authenticatedOrdersSource.createOrder(2, null, items, null)
    expect(rpc.mock.lastCall![1]).not.toHaveProperty('p_scheduled_for')
  })
})
