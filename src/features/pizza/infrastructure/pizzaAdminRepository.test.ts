import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createIngredient,
  listAdminPizzaCatalog,
  saveStyle,
  setIngredientActive,
  setStyleActive,
  updateExtras,
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
      pizza_settings: query({ data: { extra_ingredient_cents: 500, extra_cheese_cents: 3000 }, error: null }),
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
          sortOrder: 1,
          active: false,
          prices: { grande: 25000, chica: 13000 },
        },
      ],
      ingredients: [{ id: 'i1', name: 'Jamón', sortOrder: 1, active: false }],
      extras: { extraIngredientCents: 500, extraCheeseCents: 3000 },
    })
    expect(tables.pizza_styles.eq).not.toHaveBeenCalled()
    expect(tables.pizza_ingredients.eq).not.toHaveBeenCalled()
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

  it('updates the extra prices on the single settings row', async () => {
    const update = query({ error: null })
    from.mockReturnValue(update)

    await updateExtras({ extraIngredientCents: 700, extraCheeseCents: 3500 })

    expect(from).toHaveBeenCalledWith('pizza_settings')
    expect(update.update).toHaveBeenCalledWith({ extra_ingredient_cents: 700, extra_cheese_cents: 3500 })
    expect(update.eq).toHaveBeenCalledWith('id', true)
  })

  it('reports failures', async () => {
    from.mockReturnValue(query({ error: { code: 'x' } }))

    await expect(updateSize('grande', { name: 'Grande', allowedPortions: [1] })).rejects.toThrow(
      'No se pudo actualizar el tamaño.',
    )
    await expect(updateExtras({ extraIngredientCents: 700, extraCheeseCents: 3500 })).rejects.toThrow(
      'No se pudieron actualizar los extras.',
    )
  })
})
