import { expect, it, vi } from 'vitest'
import { listSessionSalesWithItems } from './returnsRepository'

const tables = vi.hoisted(() => ({
  sales: [
    { id: 's1', created_at: '2026-10-10T10:00:00Z', total_cents: 1000, received_cents: 2000, change_cents: 1000 },
    { id: 's2', created_at: '2026-10-10T09:00:00Z', total_cents: 500, received_cents: 500, change_cents: 0 },
  ],
  sale_items: [
    { id: 'i1', sale_id: 's1', product_id: 'p1', product_name: 'Pizza', unit_price_cents: 1000, quantity: 1 },
  ],
  return_items: [] as { sale_item_id: string; quantity: number }[],
}))

const rpc = vi.hoisted(() => vi.fn())

vi.mock('../../../shared/supabase/client', () => ({
  getSupabaseClient: () => ({
    from: (table: keyof typeof tables) => {
      const result = { data: tables[table], error: null }
      const chain: any = { select: () => chain, eq: () => chain, in: () => chain, order: () => result }
      chain.then = (resolve: (value: typeof result) => unknown) => resolve(result)
      return chain
    },
    rpc,
  }),
}))

it('merges order info into sales and leaves POS sales null', async () => {
  rpc.mockResolvedValue({
    data: [{ sale_id: 's1', customer_name: 'Ana', table_number: 4, waiter_name: 'Luis' }],
    error: null,
  })

  const sales = await listSessionSalesWithItems('session-1')

  expect(rpc).toHaveBeenCalledWith('list_session_sale_orders', { p_session_id: 'session-1' })
  expect(sales[0]).toMatchObject({ id: 's1', customerName: 'Ana', tableNumber: 4, waiterName: 'Luis' })
  expect(sales[1]).toMatchObject({ id: 's2', customerName: null, tableNumber: null, waiterName: null })
})

it('rejects when the order info cannot be loaded', async () => {
  rpc.mockResolvedValue({ data: null, error: new Error('boom') })
  await expect(listSessionSalesWithItems('session-1')).rejects.toThrow()
})
