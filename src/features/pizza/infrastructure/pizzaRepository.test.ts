import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listPizzaCatalog, pizzaCatalogSchema } from './pizzaRepository'

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))

vi.mock('../../../shared/supabase/client', () => ({ getSupabaseClient: () => ({ from, rpc }) }))

const sizes = [
  { code: 'chica', name: 'Chica', allowed_portions: [1, 2], sort_order: 1 },
  { code: 'grande', name: 'Grande', allowed_portions: [1, 2, 3, 4], sort_order: 2 },
]

function table(data: unknown) {
  const result = { data, error: null }
  const query: Record<string, unknown> = {
    then: (resolve: (value: typeof result) => unknown) => resolve(result),
  }
  query.eq = () => query
  query.order = () => query
  return { select: () => query }
}

beforeEach(() => {
  vi.resetAllMocks()
  from.mockImplementation((name: string) => table(name === 'pizza_sizes' ? sizes : []))
})

describe('pizzaCatalogSchema dough_left', () => {
  it('maps dough_left and defaults to unlimited when absent', () => {
    const parsed = pizzaCatalogSchema.parse({
      sizes: [{ ...sizes[0], dough_left: 4 }, { ...sizes[1], dough_left: 0 }, { ...sizes[1], code: 'mediana' }],
      styles: [],
      ingredients: [],
    })
    expect(parsed.sizes.map((size) => size.doughLeft)).toEqual([4, 0, null])
  })

  it('maps an explicit null dough_left to unlimited', () => {
    const parsed = pizzaCatalogSchema.parse({ sizes: [{ ...sizes[0], dough_left: null }], styles: [], ingredients: [] })
    expect(parsed.sizes[0]?.doughLeft).toBeNull()
  })
})

describe('listPizzaCatalog dough_left', () => {
  it('merges the dough left RPC by size code, null when the size is missing', async () => {
    rpc.mockResolvedValue({ data: [{ size_code: 'chica', dough_left: 0 }], error: null })
    const catalog = await listPizzaCatalog()
    expect(rpc).toHaveBeenCalledWith('list_pizza_dough_left')
    expect(catalog.sizes.map((size) => [size.code, size.doughLeft])).toEqual([
      ['chica', 0],
      ['grande', null],
    ])
  })

  it('keeps unlimited null counts from the RPC', async () => {
    rpc.mockResolvedValue({
      data: [
        { size_code: 'chica', dough_left: null },
        { size_code: 'grande', dough_left: 7 },
      ],
      error: null,
    })
    const catalog = await listPizzaCatalog()
    expect(catalog.sizes.map((size) => size.doughLeft)).toEqual([null, 7])
  })

  it('fails with the catalog message when the RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(listPizzaCatalog()).rejects.toThrow('No se pudo cargar el catálogo de pizzas.')
  })
})
