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
