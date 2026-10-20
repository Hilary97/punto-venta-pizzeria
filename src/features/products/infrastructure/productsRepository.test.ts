import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProduct, listProducts, updateProduct } from './productsRepository'

const { from, insert, update, select } = vi.hoisted(() => {
  const select = vi.fn()
  const insert = vi.fn()
  const update = vi.fn()
  const from = vi.fn()
  return { from, insert, update, select }
})

vi.mock('../../../shared/supabase/client', () => ({ getSupabaseClient: () => ({ from }) }))

const values = {
  categoryId: 'c1',
  name: 'Refresco',
  priceCents: 2000,
  active: true,
  variants: [],
  trackStock: true,
  stockMin: 12,
}

beforeEach(() => {
  vi.resetAllMocks()
  insert.mockResolvedValue({ error: null })
  update.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
  select.mockReturnValue({
    order: vi.fn().mockResolvedValue({
      data: [
        { id: 'p1', category_id: 'c1', name: 'Refresco', price_cents: 2000, active: true, variants: [], track_stock: true, stock: 7, stock_min: 12 },
      ],
      error: null,
    }),
  })
  from.mockReturnValue({ insert, update, select })
})

describe('products repository stock fields', () => {
  it('reads tracking, stock and minimum', async () => {
    const [product] = await listProducts()
    expect(select).toHaveBeenCalledWith('id, category_id, name, price_cents, active, variants, track_stock, stock, stock_min')
    expect(product).toMatchObject({ trackStock: true, stock: 7, stockMin: 12 })
  })

  it('writes tracking and minimum but never the stock count', async () => {
    await createProduct(values)
    await updateProduct('p1', values)
    for (const payload of [insert.mock.calls[0]![0], update.mock.calls[0]![0]]) {
      expect(payload).toMatchObject({ track_stock: true, stock_min: 12 })
      expect(payload).not.toHaveProperty('stock')
    }
  })
})
