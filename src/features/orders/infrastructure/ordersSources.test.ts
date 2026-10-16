import { describe, expect, it, vi } from 'vitest'
import { subscribeKitchenChanges } from '../../kitchen/infrastructure/kitchenRepository'
import { authenticatedOrdersSource, createDeviceOrdersSource } from './ordersSources'

vi.mock('../../../shared/supabase/client', () => ({ getSupabaseClient: () => ({ rpc: vi.fn() }) }))

describe('orders sources', () => {
  it('expose the realtime order-change signal', () => {
    expect(authenticatedOrdersSource.subscribe).toBe(subscribeKitchenChanges)
    expect(createDeviceOrdersSource('s', () => 't').subscribe).toBe(subscribeKitchenChanges)
  })
})
