import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listPizzaCatalog, pizzaCatalogSchema, pizzaConfigSchema, toRpcPizzaConfig } from './pizzaRepository'

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

describe('pizza extras', () => {
  it('defaults a catalog without extras to none', () => {
    expect(pizzaCatalogSchema.parse({ sizes: [], styles: [], ingredients: [] }).extras).toEqual([])
  })

  it('loads only active extras in catalog order', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    const eq = vi.fn()
    const order = vi.fn()
    const extras = [{ id: 'queso', name: 'Extra queso', sort_order: 1 }]
    from.mockImplementation((name: string) => {
      if (name !== 'pizza_extras') return table(name === 'pizza_sizes' ? sizes : [])
      const query: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) => resolve({ data: extras, error: null }),
      }
      query.eq = (...args: unknown[]) => (eq(...args), query)
      query.order = (...args: unknown[]) => (order(...args), query)
      return { select: () => query }
    })
    const catalog = await listPizzaCatalog()
    expect(catalog.extras).toEqual([{ id: 'queso', name: 'Extra queso', sortOrder: 1 }])
    expect(eq).toHaveBeenCalledWith('active', true)
    expect(order).toHaveBeenCalledWith('sort_order', { ascending: true })
  })

  it('maps the pizza extra_ids both ways and defaults them to none', () => {
    const parsed = pizzaConfigSchema.parse({ size: 'chica', portions: [{ style_id: 's1' }], extra_ids: ['queso', 'orilla'] })
    expect(parsed.extraIds).toEqual(['queso', 'orilla'])
    expect(toRpcPizzaConfig(parsed)).toEqual({
      size: 'chica',
      portions: [{ style_id: 's1', ingredient_ids: [], extra_ingredient_ids: [] }],
      extra_ids: ['queso', 'orilla'],
    })
    expect(pizzaConfigSchema.parse({ size: 'chica', portions: [{ style_id: 's1' }] }).extraIds).toEqual([])
  })

  it('moves legacy per-portion extra_ids to the pizza without repeating them', () => {
    const parsed = pizzaConfigSchema.parse({
      size: 'grande',
      portions: [
        { style_id: 's1', extra_ids: ['queso', 'orilla'] },
        { style_id: 's2', extra_ids: ['orilla'] },
      ],
    })
    expect(parsed.extraIds).toEqual(['queso', 'orilla'])
    expect(parsed.portions).toEqual([
      { styleId: 's1', ingredientIds: [], extraIngredientIds: [] },
      { styleId: 's2', ingredientIds: [], extraIngredientIds: [] },
    ])
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
