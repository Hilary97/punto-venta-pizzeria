import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createExtra,
  createIngredient,
  listAdminPizzaCatalog,
  saveStyle,
  setExtraActive,
  setIngredientActive,
  setStyleActive,
  updateExtra,
  updateExtraIngredientPrice,
  updateIngredient,
  updateSize,
} from './pizzaAdminRepository'

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))

vi.mock('../../../shared/supabase/client', () => ({ getSupabaseClient: () => ({ from, rpc }) }))

/** A chainable query builder that resolves to `result` once awaited. */
function query(result: { data?: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'order', 'eq', 'insert', 'update', 'single']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(result)
  return builder as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<unknown>
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('listAdminPizzaCatalog', () => {
  it('returns sizes, every style with its prices, every ingredient and the extras', async () => {
    const tables = {
      pizza_sizes: query({
        data: [{ code: 'grande', name: 'Grande', allowed_portions: [1, 2, 3, 4], sort_order: 1 }],
        error: null,
      }),
      pizza_styles: query({
        data: [
          {
            id: 's1',
            name: 'Estilo Varas',
            description: 'Pepperoni',
            kind: 'special',
            included_ingredients: 0,
            split_halves_fee_cents: 1000,
            split_thirds_fee_cents: 2000,
            split_quarters_fee_cents: 0,
            sort_order: 1,
            active: false,
          },
        ],
        error: null,
      }),
      pizza_style_prices: query({
        data: [
          { style_id: 's1', size_code: 'grande', price_cents: 25000 },
          { style_id: 's1', size_code: 'chica', price_cents: 13000 },
        ],
        error: null,
      }),
      pizza_ingredients: query({ data: [{ id: 'i1', name: 'Jamón', sort_order: 1, active: false }], error: null }),
      pizza_extras: query({
        data: [{ id: 'e1', name: 'Extra queso', price_cents: 3000, sort_order: 1, active: false }],
        error: null,
      }),
      pizza_settings: query({
        data: { extra_ingredient_cents: 500 },
        error: null,
      }),
    }
    from.mockImplementation((table: keyof typeof tables) => tables[table])

    await expect(listAdminPizzaCatalog()).resolves.toEqual({
      sizes: [{ code: 'grande', name: 'Grande', allowedPortions: [1, 2, 3, 4], sortOrder: 1 }],
      styles: [
        {
          id: 's1',
          name: 'Estilo Varas',
          description: 'Pepperoni',
          kind: 'special',
          includedIngredients: 0,
          splitFees: { halves: 1000, thirds: 2000, quarters: 0 },
          sortOrder: 1,
          active: false,
          prices: { grande: 25000, chica: 13000 },
        },
      ],
      ingredients: [{ id: 'i1', name: 'Jamón', sortOrder: 1, active: false }],
      extraIngredientCents: 500,
      extras: [{ id: 'e1', name: 'Extra queso', priceCents: 3000, sortOrder: 1, active: false }],
    })
    expect(tables.pizza_styles.eq).not.toHaveBeenCalled()
    expect(tables.pizza_ingredients.eq).not.toHaveBeenCalled()
    expect(tables.pizza_extras.eq).not.toHaveBeenCalled()
    expect(tables.pizza_extras.select).toHaveBeenCalledWith('id, name, price_cents, sort_order, active')
    expect(tables.pizza_styles.select).toHaveBeenCalledWith(
      'id, name, description, kind, included_ingredients, split_halves_fee_cents, split_thirds_fee_cents, split_quarters_fee_cents, sort_order, active',
    )
    expect(tables.pizza_settings.select).toHaveBeenCalledWith('extra_ingredient_cents')
  })

  it('fails with one message when any table fails', async () => {
    from.mockImplementation((table: string) =>
      query(table === 'pizza_settings' ? { data: null, error: { message: 'boom' } } : { data: [], error: null }),
    )

    await expect(listAdminPizzaCatalog()).rejects.toThrow('No se pudo cargar la configuración de pizzas.')
  })
})

describe('ingredient writes', () => {
  it('creates and updates with the snake_case columns', async () => {
    const insert = query({ error: null })
    const update = query({ error: null })
    from.mockReturnValueOnce(insert).mockReturnValueOnce(update)

    await createIngredient({ name: 'Elote', sortOrder: 16, active: true })
    await updateIngredient('i1', { name: 'Elote dulce', sortOrder: 17, active: false })

    expect(insert.insert).toHaveBeenCalledWith({ name: 'Elote', sort_order: 16, active: true })
    expect(update.update).toHaveBeenCalledWith({ name: 'Elote dulce', sort_order: 17, active: false })
    expect(update.eq).toHaveBeenCalledWith('id', 'i1')
  })

  it('reports a duplicate name and other failures', async () => {
    from.mockReturnValueOnce(query({ error: { code: '23505' } })).mockReturnValueOnce(query({ error: { code: 'x' } }))

    await expect(createIngredient({ name: 'Jamón', sortOrder: 1, active: true })).rejects.toThrow(
      'Ya existe un ingrediente con ese nombre.',
    )
    await expect(setIngredientActive('i1', false)).rejects.toThrow('No se pudo cambiar el estado del ingrediente.')
  })
})

describe('style writes', () => {
  const values = {
    name: 'Estilo Nuevo',
    description: 'Jamón',
    kind: 'custom' as const,
    includedIngredients: 2,
    splitFees: { halves: 1500, thirds: 0, quarters: 3000 },
    sortOrder: 20,
    active: true,
    prices: { chica: 11000, mediana: 19000, grande: 21000 },
  }

  it('saves a style and its prices through the admin RPC', async () => {
    rpc.mockResolvedValue({ data: { style_id: 's9' }, error: null })

    await expect(saveStyle(null, values)).resolves.toBe('s9')
    expect(rpc).toHaveBeenCalledWith('admin_save_pizza_style', {
      p_style_id: null,
      p_name: 'Estilo Nuevo',
      p_description: 'Jamón',
      p_kind: 'custom',
      p_included_ingredients: 2,
      p_sort_order: 20,
      p_active: true,
      p_prices: { chica: 11000, mediana: 19000, grande: 21000 },
      p_split_fees: { halves: 1500, thirds: 0, quarters: 3000 },
    })
  })

  it('surfaces the server message', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Ya existe un estilo con ese nombre.' } })

    await expect(saveStyle('s1', values)).rejects.toThrow('Ya existe un estilo con ese nombre.')
  })

  it('toggles a style active state', async () => {
    const update = query({ error: null })
    from.mockReturnValue(update)

    await setStyleActive('s1', false)

    expect(from).toHaveBeenCalledWith('pizza_styles')
    expect(update.update).toHaveBeenCalledWith({ active: false })
    expect(update.eq).toHaveBeenCalledWith('id', 's1')
  })
})

describe('size and extras writes', () => {
  it('updates a size name and its sorted allowed portions', async () => {
    const update = query({ error: null })
    from.mockReturnValue(update)

    await updateSize('grande', { name: 'Familiar', allowedPortions: [4, 1, 2] })

    expect(from).toHaveBeenCalledWith('pizza_sizes')
    expect(update.update).toHaveBeenCalledWith({ name: 'Familiar', allowed_portions: [1, 2, 4] })
    expect(update.eq).toHaveBeenCalledWith('code', 'grande')
  })

  it('updates the extra ingredient price on the single settings row', async () => {
    const update = query({ error: null })
    from.mockReturnValue(update)

    await updateExtraIngredientPrice({ extraIngredientCents: 700 })

    expect(from).toHaveBeenCalledWith('pizza_settings')
    expect(update.update).toHaveBeenCalledWith({ extra_ingredient_cents: 700 })
    expect(update.eq).toHaveBeenCalledWith('id', true)
  })

  it('reports failures', async () => {
    from.mockReturnValue(query({ error: { code: 'x' } }))

    await expect(updateSize('grande', { name: 'Grande', allowedPortions: [1] })).rejects.toThrow(
      'No se pudo actualizar el tamaño.',
    )
    await expect(updateExtraIngredientPrice({ extraIngredientCents: 700 })).rejects.toThrow(
      'No se pudo actualizar el precio del ingrediente extra.',
    )
  })
})

describe('extra writes', () => {
  it('creates and updates with the snake_case columns', async () => {
    const insert = query({ error: null })
    const update = query({ error: null })
    from.mockReturnValueOnce(insert).mockReturnValueOnce(update)

    await createExtra({ name: 'Orilla rellena', priceCents: 4000, sortOrder: 2, active: true })
    await updateExtra('e1', { name: 'Orilla de queso', priceCents: 4500, sortOrder: 3, active: false })

    expect(from).toHaveBeenCalledWith('pizza_extras')
    expect(insert.insert).toHaveBeenCalledWith({ name: 'Orilla rellena', price_cents: 4000, sort_order: 2, active: true })
    expect(update.update).toHaveBeenCalledWith({ name: 'Orilla de queso', price_cents: 4500, sort_order: 3, active: false })
    expect(update.eq).toHaveBeenCalledWith('id', 'e1')
  })

  it('toggles the active state', async () => {
    const update = query({ error: null })
    from.mockReturnValue(update)

    await setExtraActive('e1', false)

    expect(from).toHaveBeenCalledWith('pizza_extras')
    expect(update.update).toHaveBeenCalledWith({ active: false })
    expect(update.eq).toHaveBeenCalledWith('id', 'e1')
  })

  it('reports a duplicate name and other failures', async () => {
    from
      .mockReturnValueOnce(query({ error: { code: '23505' } }))
      .mockReturnValueOnce(query({ error: { code: 'x' } }))
      .mockReturnValueOnce(query({ error: { code: 'x' } }))
      .mockReturnValueOnce(query({ error: { code: 'x' } }))

    const values = { name: 'Extra queso', priceCents: 3000, sortOrder: 1, active: true }
    await expect(createExtra(values)).rejects.toThrow('Ya existe un extra con ese nombre.')
    await expect(createExtra(values)).rejects.toThrow('No se pudo crear el extra.')
    await expect(updateExtra('e1', values)).rejects.toThrow('No se pudo actualizar el extra.')
    await expect(setExtraActive('e1', true)).rejects.toThrow('No se pudo cambiar el estado del extra.')
  })
})
