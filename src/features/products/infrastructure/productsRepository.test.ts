import { beforeEach, describe, expect, it, vi } from 'vitest'
import { countStock, createProduct, listProducts, receiveStock, updateProduct } from './productsRepository'

const { from, rpc, insert, update, select } = vi.hoisted(() => {
  const select = vi.fn()
  const insert = vi.fn()
  const update = vi.fn()
  const from = vi.fn()
  const rpc = vi.fn()
  return { from, rpc, insert, update, select }
})

vi.mock('../../../shared/supabase/client', () => ({ getSupabaseClient: () => ({ from, rpc }) }))

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

describe('products repository stock RPCs', () => {
  it('receives stock through admin_receive_stock and returns the new stock', async () => {
    rpc.mockResolvedValue({ data: { product_id: 'p1', stock: 31 }, error: null })
    await expect(receiveStock('p1', 24)).resolves.toEqual({ productId: 'p1', stock: 31 })
    expect(rpc).toHaveBeenCalledWith('admin_receive_stock', { p_product_id: 'p1', p_quantity: 24 })
  })

  it('counts stock through admin_count_stock and returns the counted stock', async () => {
    rpc.mockResolvedValue({ data: { product_id: 'p1', stock: 17 }, error: null })
    await expect(countStock('p1', 17)).resolves.toEqual({ productId: 'p1', stock: 17 })
    expect(rpc).toHaveBeenCalledWith('admin_count_stock', { p_product_id: 'p1', p_stock: 17 })
  })

  it('surfaces the server error message', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'El conteo no puede ser negativo.' } })
    await expect(countStock('p1', -1)).rejects.toThrow('El conteo no puede ser negativo.')
    rpc.mockResolvedValue({ data: null, error: { message: 'La cantidad debe ser mayor a cero.' } })
    await expect(receiveStock('p1', 0)).rejects.toThrow('La cantidad debe ser mayor a cero.')
  })
})
