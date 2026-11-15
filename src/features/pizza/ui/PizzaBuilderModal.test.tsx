import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PizzaCatalog, PizzaSize } from '../domain/pizza'
import { pizzaCatalogFixture } from './pizzaCatalogFixture'
import { AUTO_ADVANCE_MS, PizzaBuilderModal } from './PizzaBuilderModal'

afterEach(() => {
  vi.useRealTimers()
})

function withDough(chica: number | null, grande: number | null): PizzaCatalog {
  const [first, second] = pizzaCatalogFixture.sizes as [PizzaSize, PizzaSize]
  return { ...pizzaCatalogFixture, sizes: [{ ...first, doughLeft: chica }, { ...second, doughLeft: grande }] }
}

/** Chica can only be a whole pizza, like the real catalog. */
function chicaWhole(catalog: PizzaCatalog = pizzaCatalogFixture): PizzaCatalog {
  const [first, ...rest] = catalog.sizes as [PizzaSize, ...PizzaSize[]]
  return { ...catalog, sizes: [{ ...first, allowedPortions: [1] }, ...rest] }
}

/** Lets a pending auto-advance (size or style tap) run. */
function flushAdvance() {
  return act(() => {
    vi.advanceTimersByTime(AUTO_ADVANCE_MS)
  })
}

/** Fake timers plus two clickers: `tap` clicks without waiting for the auto-advance; `user.click` also lets the pause pass. */
function advancingUser() {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const tap = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const user = {
    ...tap,
    click: async (element: Element) => {
      await tap.click(element)
      await flushAdvance()
    },
  }
  return { tap, user }
}

function renderBuilder(catalog: PizzaCatalog = pizzaCatalogFixture, quickPick = false) {
  const { tap, user } = advancingUser()
  const onAdd = vi.fn()
  const onClose = vi.fn()
  const view = render(<PizzaBuilderModal catalog={catalog} onAdd={onAdd} onClose={onClose} quickPick={quickPick} />)
  const next = () => user.click(screen.getByRole('button', { name: /^Siguiente/ }))
  const back = () => user.click(screen.getByRole('button', { name: /^←/ }))
  const add = () => user.click(screen.getByRole('button', { name: 'Agregar pizza' }))
  const card = (name: RegExp | string) => screen.getByRole('button', { name })
  /** Picks Estilo Varas (or the first listed style) when the open portion has none chosen yet. */
  async function pickStyle() {
    const group = screen.queryByRole('group', { name: /^Estilo de la / })
    if (!group) return
    const cards = within(group).getAllByRole('button')
    if (cards.some((c) => c.getAttribute('aria-pressed') === 'true')) return
    await user.click(cards.find((c) => /Estilo Varas/.test(c.textContent ?? '')) ?? (cards[0] as HTMLElement))
  }
  /** Taps the selected (or first available) size, then picks a style per portion (using Siguiente when a style has ingredients) until the last portion. */
  async function toIngredients() {
    const sizeGroup = screen.queryByRole('group', { name: 'Tamaño' })
    if (sizeGroup) {
      const buttons = within(sizeGroup).getAllByRole('button')
      const selected = buttons.find((c) => c.getAttribute('aria-pressed') === 'true') ?? buttons.find((c) => !(c as HTMLButtonElement).disabled)
      await user.click(selected as HTMLElement)
    }
    while (!screen.queryByRole('button', { name: 'Agregar pizza' })) {
      await pickStyle()
      const following = screen.queryByRole('button', { name: /^Siguiente/ })
      if (following && !(following as HTMLButtonElement).disabled) await next()
    }
    await pickStyle()
  }
  return { onAdd, onClose, user, tap, view, next, back, add, card, toIngredients, pickStyle }
}

const MEXICANA = { id: 'mex', name: 'Estilo Mexicana', description: '', kind: 'special', includedIngredients: 0, sortOrder: 3 } as const
const CUSTOM_ONLY: PizzaCatalog = { ...pizzaCatalogFixture, styles: pizzaCatalogFixture.styles.filter((s) => s.id === 'custom') }

describe('PizzaBuilderModal steps', () => {
  it('waits 200 ms after a tap before moving on by itself', () => {
    expect(AUTO_ADVANCE_MS).toBe(200)
  })

  it('goes Tamaño → one step per portion (division chosen on the first) with a header of completed choices', async () => {
    const { user, back, card, pickStyle } = renderBuilder()
    const steps = screen.getByRole('list', { name: 'Pasos de la pizza' })
    expect(screen.getByRole('group', { name: 'Tamaño' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '← Cancelar pizza' })).toBeVisible()

    await user.click(card('Grande'))
    expect(screen.getByRole('group', { name: 'División' })).toBeVisible()
    expect(steps).toHaveTextContent(/Tamaño ✓\s*Grande/)
    await user.click(card('Mitades'))
    expect(screen.getByRole('group', { name: 'Estilo de la Mitad 1' })).toBeVisible()
    await pickStyle()
    expect(screen.getByRole('group', { name: 'Estilo de la Mitad 2' })).toBeVisible()
    expect(steps).toHaveTextContent(/Mitad 1 ✓\s*Varas/)
    await back()
    expect(screen.getByRole('group', { name: 'Ingredientes disponibles' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Siguiente: Mitad 2 →' }))
    await pickStyle()
    expect(screen.getByRole('group', { name: 'Ingredientes disponibles' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeVisible()
  })

  it('has no separate Ingredientes step: the ingredients are on the style step', async () => {
    const { user, card } = renderBuilder(CUSTOM_ONLY)
    expect(screen.queryByRole('list', { name: 'Pasos de la pizza' })).toHaveTextContent(/Tamaño/)
    expect(screen.getByRole('list', { name: 'Pasos de la pizza' })).not.toHaveTextContent('Ingredientes')
    await user.click(card('Chica'))
    expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
    await user.click(card(/Arma tu combinación/))
    expect(screen.getByRole('group', { name: 'Ingredientes disponibles' })).toBeVisible()
    await user.click(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Piña' }))
    expect(screen.getByRole('group', { name: 'Cantidad de Piña' })).toBeVisible()
    expect(card(/Arma tu combinación/)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /Siguiente: Ingredientes/ })).not.toBeInTheDocument()
  })

  it('shows the ingredients of the newly chosen style and resets them to its defaults', async () => {
    const { user, card } = renderBuilder()
    await user.click(card('Chica'))
    await user.click(card(/Estilo Varas/))
    expect(screen.getByText(/no incluye ingredientes/i)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cambiar estilo' }))
    await user.click(card(/Arma tu combinación/))
    expect(screen.getByText('Incluye 2 ingredientes a elección · Doble cuenta como extra')).toBeVisible()
    await user.click(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Piña' }))
    await user.click(screen.getByRole('button', { name: 'Cambiar estilo' }))
    await user.click(card(/Estilo Varas/))
    expect(screen.getByText(/no incluye ingredientes/i)).toBeVisible()
    expect(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Piña' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('goes Tamaño → Pizza for a whole pizza, adding from that step', async () => {
    const { onAdd, user, add, card } = renderBuilder(chicaWhole())
    await user.click(card('Chica'))
    await user.click(card(/Estilo Varas/))
    expect(screen.getByRole('list', { name: 'Pasos de la pizza' })).toHaveTextContent(/Pizza\s*Varas/)
    expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Extras para toda la pizza' })).toBeVisible()
    expect(screen.getByLabelText(/nota de la pizza/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Siguiente/ })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/nota de la pizza/i), 'sin orilla')
    await add()
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd.mock.calls[0]?.[0].notes).toBe('sin orilla')
  })

  it('shows extras, note and quantity only on the last portion', async () => {
    const { user, next, card } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await user.click(card(/Arma tu combinación/))
    await user.click(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Pepperoni' }))
    expect(screen.getByRole('button', { name: 'Siguiente: Mitad 2 →' })).toBeEnabled()
    expect(screen.queryByRole('group', { name: 'Extras para toda la pizza' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/nota de la pizza/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Cantidad de pizzas' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agregar pizza' })).not.toBeInTheDocument()
    await next()
    await user.click(card(/Estilo Varas/))
    expect(screen.getByRole('group', { name: 'Extras para toda la pizza' })).toBeVisible()
    expect(screen.getByLabelText(/nota de la pizza/i)).toBeVisible()
    expect(screen.getByRole('group', { name: 'Cantidad de pizzas' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Siguiente/ })).not.toBeInTheDocument()
  })

  it('blocks Siguiente on a custom portion without ingredients and shows the error there', async () => {
    const { user, next, card } = renderBuilder(CUSTOM_ONLY)
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await user.click(card(/Arma tu combinación/))
    expect(screen.getByRole('button', { name: /^Siguiente/ })).toBeDisabled()
    expect(screen.getByText(/elige al menos un ingrediente/i)).toBeVisible()
    await user.click(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Pepperoni' }))
    expect(screen.getByRole('button', { name: /^Siguiente/ })).toBeEnabled()
    await next()
    await user.click(card(/Arma tu combinación/))
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeDisabled()
    expect(screen.getByText(/elige al menos un ingrediente/i)).toBeVisible()
  })

  it('skips División when the size only allows a whole pizza', async () => {
    const { user, card } = renderBuilder(chicaWhole())
    expect(screen.queryByRole('button', { name: /^Siguiente/ })).not.toBeInTheDocument()
    await user.click(card('Chica'))
    expect(screen.queryByRole('group', { name: 'División' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
  })

  it('labels the next button with the portion that follows', async () => {
    const { user, card } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    expect(screen.getByRole('button', { name: 'Siguiente: Mitad 2 →' })).toBeVisible()
  })

  it('shows a diagram that names the portion being edited', async () => {
    const { user, next, card, pickStyle } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Tercios'))
    expect(screen.getByRole('img', { name: /Tercios.*Porción 1/ })).toBeVisible()
    await pickStyle()
    await next()
    expect(screen.getByRole('img', { name: /Tercios.*Porción 2/ })).toBeVisible()
  })

  it('lets the style be chosen from cards with name and description, per portion', async () => {
    const { onAdd, user, card, add } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(card(/Estilo Varas/)).toHaveTextContent('Pepperoni y queso')
    expect(card(/Estilo Varas/)).toHaveAttribute('aria-pressed', 'false')
    expect(card(/Arma tu combinación/)).toHaveAttribute('aria-pressed', 'false')
    await user.click(card(/Estilo Varas/))
    await user.click(card(/Arma tu combinación/))
    expect(card(/Arma tu combinación/)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /Estilo Varas/ })).not.toBeInTheDocument()
    await user.click(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Piña' }))
    await add()
    expect(onAdd.mock.calls[0]?.[0].config.portions).toEqual([
      { styleId: 'varas', ingredientIds: [], extraIngredientIds: [] },
      { styleId: 'custom', ingredientIds: ['pina'], extraIngredientIds: [] },
    ])
  })

  it('keeps every choice when going back and forward', async () => {
    const { user, back, card, onClose } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Cuartos'))
    await user.click(card(/Arma tu combinación/))
    await back()
    expect(screen.getByRole('group', { name: 'Tamaño' })).toBeVisible()
    expect(card('Grande')).toHaveAttribute('aria-pressed', 'true')
    await user.click(card('Grande'))
    expect(card('Cuartos')).toHaveAttribute('aria-pressed', 'true')
    expect(card(/Arma tu combinación/)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: 'Estilo de la Porción 1' })).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('cancels the pizza from the first step', async () => {
    const { user, onClose, onAdd } = renderBuilder()
    await user.click(screen.getByRole('button', { name: '← Cancelar pizza' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onAdd).not.toHaveBeenCalled()
  })
})

describe('PizzaBuilderModal style collapse', () => {
  async function toFirstPortion() {
    const ctx = renderBuilder()
    await ctx.user.click(ctx.card('Grande'))
    await ctx.user.click(ctx.card('Mitades'))
    return ctx
  }
  const styleGroup = (name: string) => screen.getByRole('group', { name })

  it('lists every style until one is chosen', async () => {
    await toFirstPortion()
    expect(within(styleGroup('Estilo de la Mitad 1')).getAllByRole('button')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Cambiar estilo' })).not.toBeInTheDocument()
  })

  it('hides the other styles once one is chosen and keeps its ingredients right below', async () => {
    const { user, card } = await toFirstPortion()
    await user.click(card(/Arma tu combinación/))
    const cards = within(styleGroup('Estilo de la Mitad 1')).getAllByRole('button')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('Arma tu combinación')
    expect(cards[0]).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /Estilo Varas/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cambiar estilo' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Ingredientes disponibles' })).toBeVisible()
    expect(screen.getByText('Incluye 2 ingredientes a elección · Doble cuenta como extra')).toBeVisible()
  })

  it('Cambiar estilo shows the list again; picking another style collapses it and resets the ingredients', async () => {
    const { user, back, card } = await toFirstPortion()
    await user.click(card(/Arma tu combinación/))
    await user.click(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Piña' }))
    await user.click(screen.getByRole('button', { name: 'Cambiar estilo' }))
    expect(within(styleGroup('Estilo de la Mitad 1')).getAllByRole('button')).toHaveLength(2)
    expect(card(/Arma tu combinación/)).toHaveAttribute('aria-pressed', 'true')
    await user.click(card(/Estilo Varas/))
    await back()
    expect(within(styleGroup('Estilo de la Mitad 1')).getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Arma tu combinación/ })).not.toBeInTheDocument()
    expect(screen.getByText(/no incluye ingredientes/i)).toBeVisible()
    expect(screen.queryByRole('group', { name: 'Cantidad de Piña' })).not.toBeInTheDocument()
  })

  it('shows a portion that already has a style collapsed when coming back to it', async () => {
    const { user, next, back, card } = await toFirstPortion()
    await user.click(card(/Arma tu combinación/))
    await user.click(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Piña' }))
    await next()
    expect(within(styleGroup('Estilo de la Mitad 2')).getAllByRole('button')).toHaveLength(2)
    await back()
    expect(within(styleGroup('Estilo de la Mitad 1')).getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Cambiar estilo' })).toBeVisible()
  })

  it('keeps the chiles of Estilo Mexicana under the collapsed style', async () => {
    const catalog: PizzaCatalog = { ...pizzaCatalogFixture, styles: [...pizzaCatalogFixture.styles, MEXICANA] }
    const { user, card } = renderBuilder(catalog)
    await user.click(card('Chica'))
    await user.click(card(/Estilo Mexicana/))
    expect(within(styleGroup('Estilo de la Pizza entera')).getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('group', { name: 'Chile (elige uno o dos)' })).toBeVisible()
  })
})

describe('PizzaBuilderModal adding', () => {
  it('adds a whole special pizza with its description and note', async () => {
    const { onAdd, user, add, toIngredients } = renderBuilder()
    await toIngredients()
    expect(screen.getByRole('status', { name: 'Resumen de la pizza' })).toHaveTextContent('Pizza Chica · Varas')
    await user.type(screen.getByLabelText(/nota de la pizza/i), 'bien cocida')
    await add()
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith({
      config: { size: 'chica', portions: [{ styleId: 'varas', ingredientIds: [], extraIngredientIds: [] }], extraIds: [] },
      name: 'Pizza Chica: Estilo Varas',
      notes: 'bien cocida',
    })
  })

  it('adds as many identical pizzas as the quantity (1 to 20) and closes', async () => {
    const { onAdd, onClose, user, add, toIngredients } = renderBuilder()
    await toIngredients()
    const group = screen.getByRole('group', { name: 'Cantidad de pizzas' })
    expect(within(group).getByText('×1')).toBeVisible()
    expect(within(group).getByRole('button', { name: 'Menos' })).toBeDisabled()
    await user.click(within(group).getByRole('button', { name: 'Más' }))
    await user.click(within(group).getByRole('button', { name: 'Más' }))
    expect(within(group).getByText('×3')).toBeVisible()
    await add()
    expect(onAdd).toHaveBeenCalledTimes(3)
    expect(onAdd.mock.calls[1]?.[0]).toEqual(onAdd.mock.calls[0]?.[0])
    expect(onAdd.mock.calls[2]?.[0]).toEqual(onAdd.mock.calls[0]?.[0])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('caps the quantity at 20', async () => {
    const { user, toIngredients } = renderBuilder()
    await toIngredients()
    const group = screen.getByRole('group', { name: 'Cantidad de pizzas' })
    for (let i = 0; i < 25; i++) {
      const more = within(group).getByRole('button', { name: 'Más' })
      if (!(more as HTMLButtonElement).disabled) await user.click(more)
    }
    expect(within(group).getByText('×20')).toBeVisible()
    expect(within(group).getByRole('button', { name: 'Más' })).toBeDisabled()
  })

  it('shows a live summary with size, portions and extras', async () => {
    const { user, card, toIngredients } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await toIngredients()
    await user.click(within(screen.getByRole('group', { name: 'Extras para toda la pizza' })).getByRole('checkbox', { name: 'Extra queso' }))
    expect(screen.getByRole('status', { name: 'Resumen de la pizza' })).toHaveTextContent('Pizza Grande · Mitad Varas / Mitad Varas · Extra queso')
  })
})

describe('PizzaBuilderModal styles', () => {
  it('lets Estilo Mexicana pick one or two chiles, starting on the 3 chiles', async () => {
    const catalog: PizzaCatalog = { ...pizzaCatalogFixture, styles: [...pizzaCatalogFixture.styles, MEXICANA] }
    const { onAdd, user, add, card, toIngredients } = renderBuilder(catalog)
    await user.click(card('Chica'))
    await user.click(card(/Estilo Varas/))
    expect(screen.queryByRole('group', { name: /chile/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cambiar estilo' }))
    await user.click(card(/Estilo Mexicana/))
    const chiles = screen.getByRole('group', { name: 'Chile (elige uno o dos)' })
    const chip = (name: string) => within(chiles).getByRole('button', { name })
    expect(within(chiles).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Morrón',
      'Serrano',
      'Jalapeño',
      'Los 3 chiles',
    ])
    expect(chip('Los 3 chiles')).toHaveAttribute('aria-pressed', 'true')
    await user.click(chip('Jalapeño'))
    expect(chip('Los 3 chiles')).toHaveAttribute('aria-pressed', 'false')
    await user.click(chip('Morrón'))
    expect(chip('Serrano')).toHaveAttribute('aria-pressed', 'false')
    await toIngredients()
    await add()
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          size: 'chica',
          portions: [{ styleId: 'mex', ingredientIds: [], extraIngredientIds: [], chiles: ['morron', 'jalapeno'] }],
          extraIds: [],
        },
        name: 'Pizza Chica: Estilo Mexicana (Morrón y jalapeño)',
      }),
    )
  })

  it('lists Pepperoni and Hawaiana first, then the rest A-Z, and preselects none', async () => {
    const catalog: PizzaCatalog = {
      ...pizzaCatalogFixture,
      styles: [
        ...pizzaCatalogFixture.styles,
        { id: 'hawaiana', name: 'Estilo Hawaiana', description: '', kind: 'special', includedIngredients: 0, sortOrder: 3 },
        { id: 'pepperoni', name: 'Estilo Pepperoni', description: '', kind: 'special', includedIngredients: 0, sortOrder: 4 },
      ],
    }
    const { user, card } = renderBuilder(catalog)
    await user.click(card('Chica'))
    const cards = within(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).getAllByRole('button')
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining('Estilo Pepperoni'),
      expect.stringContaining('Estilo Hawaiana'),
      expect.stringContaining('Arma tu combinación'),
      expect.stringContaining('Estilo Varas'),
    ])
    for (const c of cards) expect(c).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows only the divisions allowed by the size and resets an invalid one when resizing', async () => {
    const { user, back, card } = renderBuilder()
    await user.click(card('Chica'))
    const division = screen.getByRole('group', { name: 'División' })
    expect(within(division).queryByRole('button', { name: 'Cuartos' })).not.toBeInTheDocument()
    await back()
    await user.click(card('Grande'))
    await user.click(card('Cuartos'))
    expect(screen.getByRole('group', { name: 'Estilo de la Porción 1' })).toBeVisible()
    await back()
    await user.click(card('Chica'))
    expect(card('Entera')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('PizzaBuilderModal ingredients', () => {
  const chips = () => screen.getByRole('group', { name: 'Ingredientes disponibles' })
  const level = (name: string, option: 'Normal' | 'Doble' | 'Quitar') =>
    within(screen.getByRole('group', { name: `Cantidad de ${name}` })).getByRole('button', { name: option })

  it('shows the real included count in the legend', async () => {
    const { toIngredients } = renderBuilder(CUSTOM_ONLY)
    await toIngredients()
    expect(screen.getByText('Incluye 2 ingredientes a elección · Doble cuenta como extra')).toBeVisible()
  })

  it('requires at least one ingredient for the custom style and keeps extras beyond the limit charged', async () => {
    const { onAdd, user, add, toIngredients } = renderBuilder(CUSTOM_ONLY)
    await toIngredients()
    const addButton = screen.getByRole('button', { name: 'Agregar pizza' })
    expect(addButton).toBeDisabled()
    expect(screen.getByText(/elige al menos un ingrediente/i)).toBeVisible()

    await user.click(within(chips()).getByRole('button', { name: 'Pepperoni' }))
    expect(addButton).toBeEnabled()
    await user.click(within(chips()).getByRole('button', { name: 'Jalapeños' }))
    expect(screen.getByText('Ingredientes incluidos: 2/2')).toBeVisible()
    await user.click(within(chips()).getByRole('button', { name: /Piña/ }))
    await add()
    expect(onAdd.mock.calls[0]?.[0].config.portions).toEqual([
      { styleId: 'custom', ingredientIds: ['pep', 'jal'], extraIngredientIds: ['pina'] },
    ])
    expect(onAdd.mock.calls[0]?.[0].name).toBe('Pizza Chica: Arma tu combinación (Jalapeños, Pepperoni) + Piña')
  })

  it('Normal / Doble / Quitar gives the same pizza as the old tap cycle for an included ingredient', async () => {
    const { onAdd, user, add, toIngredients } = renderBuilder(CUSTOM_ONLY)
    await toIngredients()
    await user.click(within(chips()).getByRole('button', { name: 'Jalapeños' }))
    expect(level('Jalapeños', 'Normal')).toHaveAttribute('aria-pressed', 'true')
    await user.click(level('Jalapeños', 'Doble'))
    expect(level('Jalapeños', 'Doble')).toHaveAttribute('aria-pressed', 'true')
    expect(level('Jalapeños', 'Normal')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Ingredientes incluidos: 1/2')).toBeVisible()
    await add()
    expect(onAdd.mock.calls[0]?.[0].config.portions).toEqual([
      { styleId: 'custom', ingredientIds: ['jal'], extraIngredientIds: ['jal'] },
    ])
    expect(onAdd.mock.calls[0]?.[0].name).toBe('Pizza Chica: Arma tu combinación (Extra Jalapeños)')

    await user.click(level('Jalapeños', 'Quitar'))
    expect(screen.queryByRole('group', { name: 'Cantidad de Jalapeños' })).not.toBeInTheDocument()
    expect(screen.getByText('Ingredientes incluidos: 0/2')).toBeVisible()
    expect(within(chips()).getByRole('button', { name: 'Jalapeños' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('charges an ingredient on a style without included ones, doubled twice', async () => {
    const { onAdd, user, add, toIngredients } = renderBuilder()
    await toIngredients()
    expect(screen.getByText(/no incluye ingredientes/i)).toBeVisible()
    await user.click(within(chips()).getByRole('button', { name: 'Jalapeños' }))
    await user.click(level('Jalapeños', 'Doble'))
    await add()
    expect(onAdd.mock.calls[0]?.[0].config.portions).toEqual([
      { styleId: 'varas', ingredientIds: [], extraIngredientIds: ['jal', 'jal'] },
    ])
    expect(onAdd.mock.calls[0]?.[0].name).toBe('Pizza Chica: Estilo Varas + Extra Jalapeños')
  })

  it('lets a special style add its included ingredients without requiring them', async () => {
    const catalog: PizzaCatalog = {
      ...pizzaCatalogFixture,
      styles: pizzaCatalogFixture.styles.map((style) => ({ ...style, includedIngredients: 2 })),
    }
    const { onAdd, user, add, toIngredients } = renderBuilder(catalog)
    await toIngredients()
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeEnabled()
    await user.click(within(chips()).getByRole('button', { name: 'Pepperoni' }))
    await user.click(within(chips()).getByRole('button', { name: 'Jalapeños' }))
    await add()
    expect(onAdd.mock.calls[0]?.[0].name).toBe('Pizza Chica: Estilo Varas (Jalapeños, Pepperoni)')
  })

  it('configures each portion on its own step', async () => {
    const { onAdd, user, next, back, add, card, pickStyle } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await pickStyle()
    await pickStyle()
    await user.click(within(chips()).getByRole('button', { name: 'Jalapeños' }))
    await back()
    expect(within(chips()).getByRole('button', { name: 'Jalapeños' })).toHaveAttribute('aria-pressed', 'false')
    await next()
    expect(within(chips()).getByRole('button', { name: 'Jalapeños' })).toHaveAttribute('aria-pressed', 'true')
    await add()
    expect(onAdd.mock.calls[0]?.[0].config.portions).toEqual([
      { styleId: 'varas', ingredientIds: [], extraIngredientIds: [] },
      { styleId: 'varas', ingredientIds: [], extraIngredientIds: ['jal'] },
    ])
  })

  it('lists ingredients and extras alphabetically and applies extras to the whole pizza', async () => {
    const { onAdd, user, add, toIngredients } = renderBuilder()
    await toIngredients()
    expect(within(chips()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Jalapeños', 'Pepperoni', 'Piña'])
    const extras = screen.getByRole('group', { name: 'Extras para toda la pizza' })
    expect(within(extras).getAllByRole('checkbox').map((b) => b.getAttribute('aria-label') ?? b.parentElement?.textContent)).toEqual([
      'Extra queso',
      'Orilla rellena',
    ])
    await user.click(within(extras).getByRole('checkbox', { name: 'Orilla rellena' }))
    await user.click(within(extras).getByRole('checkbox', { name: 'Extra queso' }))
    await add()
    expect(onAdd.mock.calls[0]?.[0].config.extraIds).toEqual(['orilla', 'queso'])
    expect(onAdd.mock.calls[0]?.[0].name).toBe('Pizza Chica: Estilo Varas + Extra queso, Orilla rellena')
  })

  it('hides the extras group when there are no active extras', async () => {
    const { toIngredients } = renderBuilder({ ...pizzaCatalogFixture, extras: [] })
    await toIngredients()
    expect(screen.queryByRole('group', { name: 'Extras para toda la pizza' })).not.toBeInTheDocument()
  })

  it('keeps the pizza extras when the division changes', async () => {
    const { onAdd, user, add, card, toIngredients } = renderBuilder()
    await user.click(card('Chica'))
    await user.click(screen.getByRole('checkbox', { name: 'Extra queso' }))
    await user.click(card('Mitades'))
    await toIngredients()
    await add()
    expect(onAdd.mock.calls[0]?.[0].config.extraIds).toEqual(['queso'])
  })

  it('enforces the note length limit', async () => {
    const { toIngredients } = renderBuilder()
    await toIngredients()
    expect(screen.getByLabelText(/nota de la pizza/i)).toHaveAttribute('maxlength')
  })
})

describe('PizzaBuilderModal pizza dough', () => {
  it('shows a sold-out size as Agotado and cannot select it', async () => {
    const { user, card } = renderBuilder(withDough(null, 0))
    const grande = card(/Grande/)
    expect(within(grande).getByText('Agotado')).toBeVisible()
    expect(grande).toBeDisabled()
    await user.click(grande)
    expect(card(/Chica/)).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('group', { name: 'Tamaño' })).toBeVisible()
  })

  it('lets the available size be picked when the first one is sold out', async () => {
    const { onAdd, add, toIngredients, card } = renderBuilder(withDough(0, 5))
    expect(card(/Chica/)).toBeDisabled()
    await toIngredients()
    await add()
    expect(onAdd.mock.calls[0]?.[0].config.size).toBe('grande')
  })

  it('shows how many doughs remain for a limited size and nothing for an unlimited one', () => {
    renderBuilder(withDough(3, null))
    expect(within(screen.getByRole('button', { name: /Chica/ })).getByText('Quedan 3')).toBeVisible()
    expect(screen.queryByText('Agotado')).not.toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /Grande/ })).queryByText(/Quedan/)).not.toBeInTheDocument()
  })

  it('blocks continuing when every size is sold out', () => {
    renderBuilder(withDough(0, 0))
    expect(screen.getByText('No hay masas de pizza disponibles.')).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Siguiente/ })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Tamaño' })).toBeVisible()
    expect(screen.getAllByText('Agotado')).toHaveLength(2)
  })
})

describe('PizzaBuilderModal no default style', () => {
  it('starts a portion with no style selected and no ingredient controls', async () => {
    const { user, card } = renderBuilder()
    await user.click(card('Chica'))
    const cards = within(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).getAllByRole('button')
    expect(cards).toHaveLength(2)
    for (const card of cards) expect(card).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('group', { name: 'Ingredientes disponibles' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Incluye \d+ ingredientes|no incluye ingredientes/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cambiar estilo' })).not.toBeInTheDocument()
  })

  it('blocks the footer button with a hint until a style is chosen', async () => {
    const { user, card, onAdd } = renderBuilder(chicaWhole())
    await user.click(card('Chica'))
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeDisabled()
    expect(screen.getByText('Elige el estilo de la pizza')).toBeVisible()
    expect(screen.getByRole('status', { name: 'Resumen de la pizza' })).not.toHaveTextContent('Varas')
    await user.click(card(/Estilo Varas/))
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeEnabled()
    expect(screen.queryByText('Elige el estilo de la pizza')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Agregar pizza' }))
    expect(onAdd.mock.calls[0]?.[0].config.portions).toEqual([{ styleId: 'varas', ingredientIds: [], extraIngredientIds: [] }])
  })

  it('shows the ingredients and collapses the list once a style is chosen', async () => {
    const { user, card } = renderBuilder(CUSTOM_ONLY)
    await user.click(card('Chica'))
    await user.click(card(/Arma tu combinación/))
    expect(screen.getByRole('group', { name: 'Ingredientes disponibles' })).toBeVisible()
    expect(screen.getByText('Incluye 2 ingredientes a elección · Doble cuenta como extra')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cambiar estilo' })).toBeVisible()
  })

  it('every half starts without a style and blocks Siguiente until chosen', async () => {
    const { user, card } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    expect(screen.getByRole('button', { name: 'Siguiente: Mitad 2 →' })).toBeDisabled()
    expect(screen.getByText('Elige el estilo de la mitad 1')).toBeVisible()
    await user.click(card(/Estilo Varas/))
    expect(within(screen.getByRole('group', { name: 'Estilo de la Mitad 2' })).getAllByRole('button')).toHaveLength(2)
    expect(screen.queryByRole('group', { name: 'Ingredientes disponibles' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeDisabled()
    expect(screen.getByText('Elige el estilo de la mitad 2')).toBeVisible()
    expect(screen.getByRole('status', { name: 'Resumen de la pizza' })).toHaveTextContent('Mitad 2 sin estilo')
  })
})

describe('PizzaBuilderModal auto-advance', () => {
  const stepsList = () => screen.getByRole('list', { name: 'Pasos de la pizza' })
  const divisionGroup = () => screen.getByRole('group', { name: 'División' })

  describe('size step (S2)', () => {
    it('has no Siguiente button and tapping a size goes straight to the first portion', async () => {
      const { user, card } = renderBuilder()
      expect(screen.getByRole('group', { name: 'Tamaño' })).toBeVisible()
      expect(screen.queryByRole('button', { name: /^Siguiente/ })).not.toBeInTheDocument()
      await user.click(card('Grande'))
      expect(screen.queryByRole('group', { name: 'Tamaño' })).not.toBeInTheDocument()
      expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
      expect(screen.getByRole('status', { name: 'Resumen de la pizza' })).toHaveTextContent('Pizza Grande')
    })

    it('also advances when the already selected size is tapped, keeping the choice', async () => {
      const { user, back, card } = renderBuilder()
      await user.click(card('Chica'))
      await back()
      expect(card('Chica')).toHaveAttribute('aria-pressed', 'true')
      await user.click(card('Chica'))
      expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
      expect(screen.getByRole('status', { name: 'Resumen de la pizza' })).toHaveTextContent('Pizza Chica')
    })

    it('keeps a sold-out size disabled and does not advance when it is tapped', async () => {
      const { user, card } = renderBuilder(withDough(null, 0))
      expect(card(/Grande/)).toBeDisabled()
      await user.click(card(/Grande/))
      expect(screen.getByRole('group', { name: 'Tamaño' })).toBeVisible()
      expect(screen.queryByRole('group', { name: /^Estilo de la / })).not.toBeInTheDocument()
    })
  })

  describe('division (S3)', () => {
    it('starts as Entera, with no División step in the flow or the header', async () => {
      const { user, card } = renderBuilder()
      await user.click(card('Grande'))
      expect(stepsList()).not.toHaveTextContent('División')
      expect(within(stepsList()).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        expect.stringContaining('Tamaño'),
        expect.stringContaining('Pizza'),
      ])
      expect(within(divisionGroup()).getByRole('button', { name: 'Entera' })).toHaveAttribute('aria-pressed', 'true')
      expect(within(divisionGroup()).getByRole('button', { name: 'Mitades' })).toHaveAttribute('aria-pressed', 'false')
    })

    it('shows the selector above the styles with the divisions the size allows', async () => {
      const { user, card } = renderBuilder()
      await user.click(card('Grande'))
      const names = within(divisionGroup()).getAllByRole('button').map((button) => button.textContent)
      expect(names).toEqual(['Entera', 'Mitades', 'Tercios', 'Cuartos'])
      const styles = screen.getByRole('group', { name: 'Estilo de la Pizza entera' })
      expect(divisionGroup().compareDocumentPosition(styles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('does not show the selector when the size only allows a whole pizza', async () => {
      const { user, card } = renderBuilder(chicaWhole())
      await user.click(card('Chica'))
      expect(screen.queryByRole('group', { name: 'División' })).not.toBeInTheDocument()
      expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
    })

    it('adds and removes portion steps and keeps the styles already chosen', async () => {
      const { user, card, next } = renderBuilder()
      await user.click(card('Grande'))
      await user.click(card(/Arma tu combinación/))
      await user.click(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Piña' }))
      await user.click(card('Mitades'))
      expect(within(stepsList()).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        expect.stringContaining('Tamaño'),
        expect.stringContaining('Mitad 1'),
        expect.stringContaining('Mitad 2'),
      ])
      expect(screen.getByRole('group', { name: 'Estilo de la Mitad 1' })).toBeVisible()
      expect(card(/Arma tu combinación/)).toHaveAttribute('aria-pressed', 'true')
      expect(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Piña' })).toHaveAttribute('aria-pressed', 'true')
      await next()
      expect(within(screen.getByRole('group', { name: 'Estilo de la Mitad 2' })).getAllByRole('button')).toHaveLength(2)
      expect(screen.queryByRole('group', { name: 'División' })).not.toBeInTheDocument()
    })

    it('goes back to Entera removing the extra portion steps', async () => {
      const { user, card } = renderBuilder()
      await user.click(card('Grande'))
      await user.click(card('Tercios'))
      expect(within(stepsList()).getAllByRole('listitem')).toHaveLength(4)
      await user.click(card('Entera'))
      expect(within(stepsList()).getAllByRole('listitem')).toHaveLength(2)
      expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
    })

    it('falls back to Entera when another size does not allow the current division', async () => {
      const { user, back, card } = renderBuilder()
      await user.click(card('Grande'))
      await user.click(card('Cuartos'))
      await back()
      await user.click(card('Chica'))
      expect(card('Entera')).toHaveAttribute('aria-pressed', 'true')
      expect(within(divisionGroup()).queryByRole('button', { name: 'Cuartos' })).not.toBeInTheDocument()
    })
  })

  describe('style (S4)', () => {
    it('moves to the next portion at once when the style has no ingredients to choose', async () => {
      const { user, card } = renderBuilder()
      await user.click(card('Grande'))
      await user.click(card('Mitades'))
      await user.click(card(/Estilo Varas/))
      expect(screen.getByRole('group', { name: 'Estilo de la Mitad 2' })).toBeVisible()
      expect(screen.queryByRole('group', { name: 'Estilo de la Mitad 1' })).not.toBeInTheDocument()
      expect(stepsList()).toHaveTextContent(/Mitad 1 ✓\s*Varas/)
      expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeDisabled()
      expect(screen.getByText('Elige el estilo de la mitad 2')).toBeVisible()
    })

    it('enables Agregar pizza right away on the last portion and stays there', async () => {
      const { onAdd, user, add, card } = renderBuilder()
      await user.click(card('Grande'))
      await user.click(card('Mitades'))
      await user.click(card(/Estilo Varas/))
      await user.click(card(/Estilo Varas/))
      expect(screen.getByRole('group', { name: 'Estilo de la Mitad 2' })).toBeVisible()
      expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeEnabled()
      expect(screen.queryByRole('button', { name: /^Siguiente/ })).not.toBeInTheDocument()
      await add()
      expect(onAdd.mock.calls[0]?.[0].config.portions).toEqual([
        { styleId: 'varas', ingredientIds: [], extraIngredientIds: [] },
        { styleId: 'varas', ingredientIds: [], extraIngredientIds: [] },
      ])
    })

    it('stays on its step with Siguiente when the style has ingredients to choose', async () => {
      const { user, next, card } = renderBuilder()
      await user.click(card('Grande'))
      await user.click(card('Mitades'))
      await user.click(card(/Arma tu combinación/))
      expect(screen.getByRole('group', { name: 'Estilo de la Mitad 1' })).toBeVisible()
      expect(screen.getByRole('group', { name: 'Ingredientes disponibles' })).toBeVisible()
      await user.click(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Pepperoni' }))
      expect(screen.getByRole('button', { name: 'Siguiente: Mitad 2 →' })).toBeEnabled()
      await next()
      expect(screen.getByRole('group', { name: 'Estilo de la Mitad 2' })).toBeVisible()
    })

    it('keeps a style with a chile choice on its step', async () => {
      const catalog: PizzaCatalog = { ...pizzaCatalogFixture, styles: [...pizzaCatalogFixture.styles, MEXICANA] }
      const { user, card } = renderBuilder(catalog)
      await user.click(card('Grande'))
      await user.click(card('Mitades'))
      await user.click(card(/Estilo Mexicana/))
      expect(screen.getByRole('group', { name: 'Estilo de la Mitad 1' })).toBeVisible()
      expect(screen.getByRole('group', { name: 'Chile (elige uno o dos)' })).toBeVisible()
      expect(screen.getByRole('button', { name: 'Siguiente: Mitad 2 →' })).toBeEnabled()
    })

    it('does not advance when only the ingredients of a style are changed', async () => {
      const { user, back, card } = renderBuilder()
      await user.click(card('Grande'))
      await user.click(card('Mitades'))
      await user.click(card(/Estilo Varas/))
      await back()
      expect(screen.getByRole('group', { name: 'Estilo de la Mitad 1' })).toBeVisible()
      await user.click(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Jalapeños' }))
      expect(screen.getByRole('group', { name: 'Estilo de la Mitad 1' })).toBeVisible()
    })
  })

  describe('back and last step (S5)', () => {
    it('goes from the first portion back to Tamaño and from there to cancel', async () => {
      const { user, onClose, back, card } = renderBuilder()
      await user.click(card('Grande'))
      expect(screen.getByRole('button', { name: '← Tamaño' })).toBeVisible()
      await back()
      expect(screen.getByRole('group', { name: 'Tamaño' })).toBeVisible()
      expect(card('Grande')).toHaveAttribute('aria-pressed', 'true')
      await user.click(screen.getByRole('button', { name: '← Cancelar pizza' }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('goes back from the second portion to the first with its style kept', async () => {
      const { user, back, card } = renderBuilder()
      await user.click(card('Grande'))
      await user.click(card('Mitades'))
      await user.click(card(/Estilo Varas/))
      expect(screen.getByRole('button', { name: '← Mitad 1' })).toBeVisible()
      await back()
      expect(card(/Estilo Varas/)).toHaveAttribute('aria-pressed', 'true')
    })

    it('keeps extras, note, quantity and Agregar pizza on the last portion', async () => {
      const { onAdd, user, add, next, card } = renderBuilder()
      await user.click(card('Grande'))
      await user.click(card('Mitades'))
      await user.click(card(/Arma tu combinación/))
      await user.click(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Pepperoni' }))
      expect(screen.queryByRole('group', { name: 'Extras para toda la pizza' })).not.toBeInTheDocument()
      expect(screen.queryByRole('group', { name: 'Cantidad de pizzas' })).not.toBeInTheDocument()
      await next()
      await user.click(card(/Estilo Varas/))
      expect(screen.getByRole('group', { name: 'Extras para toda la pizza' })).toBeVisible()
      expect(screen.getByLabelText(/nota de la pizza/i)).toBeVisible()
      expect(screen.getByRole('group', { name: 'Cantidad de pizzas' })).toBeVisible()
      await user.click(screen.getByRole('checkbox', { name: 'Extra queso' }))
      await add()
      expect(onAdd.mock.calls[0]?.[0].config.extraIds).toEqual(['queso'])
    })

    it('adds an entera pizza with a style without ingredient choices in 3 taps after opening the builder', async () => {
      const { onAdd, onClose, user, card } = renderBuilder()
      let taps = 0
      const count = () => {
        taps += 1
      }
      document.addEventListener('click', count)
      try {
        await user.click(card('Grande'))
        await user.click(card(/Estilo Varas/))
        await user.click(screen.getByRole('button', { name: 'Agregar pizza' }))
      } finally {
        document.removeEventListener('click', count)
      }
      expect(taps).toBe(3)
      expect(onAdd).toHaveBeenCalledTimes(1)
      expect(onAdd.mock.calls[0]?.[0].config).toEqual({
        size: 'grande',
        portions: [{ styleId: 'varas', ingredientIds: [], extraIngredientIds: [] }],
        extraIds: [],
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('fixes a quick pizza (Fijar pizza) with the same flow', async () => {
      const onAdd = vi.fn()
      render(<PizzaBuilderModal catalog={pizzaCatalogFixture} onAdd={onAdd} onClose={vi.fn()} quickPick />)
      const { user } = advancingUser()
      await user.click(screen.getByRole('button', { name: 'Grande' }))
      await user.click(screen.getByRole('button', { name: /Estilo Varas/ }))
      expect(screen.queryByRole('group', { name: 'Cantidad de pizzas' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Fijar pizza' }))
      expect(onAdd).toHaveBeenCalledTimes(1)
    })
  })
})

describe('PizzaBuilderModal portion notes', () => {
  async function toLastHalf() {
    const built = renderBuilder()
    await built.user.click(built.card('Grande'))
    await built.user.click(built.card('Mitades'))
    await built.pickStyle()
    await built.pickStyle()
    return built
  }

  it('shows a note per portion on the last step, labelled with the portion and its style, before the pizza note', async () => {
    await toLastHalf()
    const group = screen.getByRole('group', { name: 'Notas por porción' })
    expect(within(group).getByLabelText('Mitad 1 · Varas')).toBeVisible()
    expect(within(group).getByLabelText('Mitad 2 · Varas')).toBeVisible()
    const pizzaNote = screen.getByLabelText(/nota de la pizza/i)
    expect(group.compareDocumentPosition(pizzaNote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not show them before the last step', async () => {
    const { user, card, pickStyle } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await pickStyle()
    await user.click(screen.getByRole('button', { name: /^←/ }))
    expect(screen.queryByRole('group', { name: 'Notas por porción' })).not.toBeInTheDocument()
  })

  it('adds the pizza with trimmed portion notes and drops a blank one, keeping the pizza note apart', async () => {
    const { onAdd, user, add } = await toLastHalf()
    await user.type(screen.getByLabelText('Mitad 1 · Varas'), '  sin piña en la orilla ')
    await user.type(screen.getByLabelText('Mitad 2 · Varas'), '   ')
    await user.type(screen.getByLabelText(/nota de la pizza/i), 'bien cocida')
    await add()
    const built = onAdd.mock.calls[0]![0]
    expect(built.config.portions).toEqual([
      { styleId: 'varas', ingredientIds: [], extraIngredientIds: [], note: 'sin piña en la orilla' },
      { styleId: 'varas', ingredientIds: [], extraIngredientIds: [] },
    ])
    expect(built.name).toBe('Pizza Grande · Mitades: ½ Estilo Varas — sin piña en la orilla | ½ Estilo Varas')
    expect(built.notes).toBe('bien cocida')
  })

  it('limits each note to 80 characters', async () => {
    await toLastHalf()
    expect(screen.getByLabelText('Mitad 1 · Varas')).toHaveAttribute('maxlength', '80')
  })

  it('names the third portions Porción 3', async () => {
    const { user, card, pickStyle } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Tercios'))
    await pickStyle()
    await pickStyle()
    await pickStyle()
    expect(screen.getByLabelText('Porción 3 · Varas')).toBeVisible()
  })

  it('shows no portion notes on a whole pizza and sends none after going back from halves', async () => {
    const whole = renderBuilder()
    await whole.toIngredients()
    expect(screen.queryByRole('group', { name: 'Notas por porción' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/nota de la pizza/i)).toBeVisible()
  })

  it('drops the portion notes when the division goes back to a whole pizza', async () => {
    const { onAdd, user, back, card, add, pickStyle } = await toLastHalf()
    await user.type(screen.getByLabelText('Mitad 1 · Varas'), 'sin piña')
    await back()
    await user.click(card('Entera'))
    await pickStyle()
    expect(screen.queryByRole('group', { name: 'Notas por porción' })).not.toBeInTheDocument()
    await add()
    expect(onAdd.mock.calls[0]![0].config.portions).toEqual([{ styleId: 'varas', ingredientIds: [], extraIngredientIds: [] }])
  })

  it('does not offer them when pinning a quick pizza', async () => {
    const onAdd = vi.fn()
    render(<PizzaBuilderModal catalog={pizzaCatalogFixture} onAdd={onAdd} onClose={vi.fn()} quickPick />)
    const { user } = advancingUser()
    await user.click(screen.getByRole('button', { name: 'Grande' }))
    await user.click(screen.getByRole('button', { name: 'Mitades' }))
    for (let i = 0; i < 2; i++) {
      const group = screen.getByRole('group', { name: /^Estilo de la / })
      await user.click(within(group).getAllByRole('button').find((c) => /Estilo Varas/.test(c.textContent ?? '')) as HTMLElement)
    }
    expect(screen.getByRole('button', { name: 'Fijar pizza' })).toBeVisible()
    expect(screen.queryByRole('group', { name: 'Notas por porción' })).not.toBeInTheDocument()
  })
})

describe('PizzaBuilderModal note shortcuts', () => {
  const shortcuts = ['Sin cebolla', 'Bien cocida']

  async function toLast(options: { shortcuts?: string[]; halves?: boolean } = {}) {
    const onAdd = vi.fn()
    render(<PizzaBuilderModal catalog={pizzaCatalogFixture} onAdd={onAdd} onClose={vi.fn()} noteShortcuts={options.shortcuts ?? shortcuts} />)
    const { user } = advancingUser()
    await user.click(screen.getByRole('button', { name: 'Grande' }))
    if (options.halves !== false) await user.click(screen.getByRole('button', { name: 'Mitades' }))
    const count = options.halves === false ? 1 : 2
    for (let i = 0; i < count; i++) {
      const group = screen.getByRole('group', { name: /^Estilo de la / })
      await user.click(within(group).getAllByRole('button').find((c) => /Estilo Varas/.test(c.textContent ?? '')) as HTMLElement)
    }
    return { onAdd, user }
  }

  it('shows toggle chips under each portion note and under the pizza note', async () => {
    await toLast()
    for (const name of ['Atajos de Mitad 1 · Varas', 'Atajos de Mitad 2 · Varas', 'Atajos de notas de la pizza']) {
      const group = screen.getByRole('group', { name: name })
      expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(shortcuts)
      for (const chip of within(group).getAllByRole('button')) expect(chip).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('appends a tapped shortcut to that note only, joined with ", ", and removes it on a second tap', async () => {
    const { user } = await toLast()
    const half1 = screen.getByRole('group', { name: 'Atajos de Mitad 1 · Varas' })
    await user.type(screen.getByLabelText('Mitad 1 · Varas'), 'poca sal')
    await user.click(within(half1).getByRole('button', { name: 'Sin cebolla' }))
    await user.click(within(half1).getByRole('button', { name: 'Bien cocida' }))
    expect(screen.getByLabelText('Mitad 1 · Varas')).toHaveValue('poca sal, Sin cebolla, Bien cocida')
    expect(screen.getByLabelText('Mitad 2 · Varas')).toHaveValue('')
    expect(within(half1).getByRole('button', { name: 'Sin cebolla' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(half1).getByRole('button', { name: 'Sin cebolla' }))
    expect(screen.getByLabelText('Mitad 1 · Varas')).toHaveValue('poca sal, Bien cocida')
    expect(within(half1).getByRole('button', { name: 'Sin cebolla' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('fills the pizza note and keeps free text working, sending both notes with the pizza', async () => {
    const { onAdd, user } = await toLast()
    const half2 = screen.getByRole('group', { name: 'Atajos de Mitad 2 · Varas' })
    await user.click(within(half2).getByRole('button', { name: 'Bien cocida' }))
    await user.type(screen.getByLabelText('Mitad 2 · Varas'), ' y crujiente')
    const pizzaGroup = screen.getByRole('group', { name: 'Atajos de notas de la pizza' })
    await user.click(within(pizzaGroup).getByRole('button', { name: 'Sin cebolla' }))
    expect(screen.getByLabelText(/nota de la pizza/i)).toHaveValue('Sin cebolla')
    await user.click(screen.getByRole('button', { name: 'Agregar pizza' }))
    const built = onAdd.mock.calls[0]![0]
    expect(built.notes).toBe('Sin cebolla')
    expect(built.config.portions[1].note).toBe('Bien cocida y crujiente')
    expect(built.config.portions[0].note).toBeUndefined()
  })

  it('works on a whole pizza with only the pizza note chips', async () => {
    const { user } = await toLast({ halves: false })
    expect(screen.queryByRole('group', { name: /^Atajos de Mitad/ })).not.toBeInTheDocument()
    await user.click(within(screen.getByRole('group', { name: 'Atajos de notas de la pizza' })).getByRole('button', { name: 'Bien cocida' }))
    expect(screen.getByLabelText(/nota de la pizza/i)).toHaveValue('Bien cocida')
  })

  it('does not append past the 80-character portion limit: the chip is disabled and the note stays', async () => {
    const { user } = await toLast({ shortcuts: ['Sin cebolla'] })
    const note = screen.getByLabelText('Mitad 1 · Varas')
    await user.type(note, 'x'.repeat(75))
    const chip = within(screen.getByRole('group', { name: 'Atajos de Mitad 1 · Varas' })).getByRole('button', { name: 'Sin cebolla' })
    expect(chip).toBeDisabled()
    await user.click(chip)
    expect(note).toHaveValue('x'.repeat(75))
  })

  it('shows no chips when there are no shortcuts', async () => {
    await toLast({ shortcuts: [] })
    expect(screen.queryByRole('group', { name: /^Atajos de/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Mitad 1 · Varas')).toBeVisible()
  })

  it('shows no chips when pinning a quick pizza', async () => {
    render(<PizzaBuilderModal catalog={pizzaCatalogFixture} onAdd={vi.fn()} onClose={vi.fn()} quickPick noteShortcuts={shortcuts} />)
    const { user } = advancingUser()
    await user.click(screen.getByRole('button', { name: 'Grande' }))
    await user.click(screen.getByRole('button', { name: 'Mitades' }))
    for (let i = 0; i < 2; i++) {
      const group = screen.getByRole('group', { name: /^Estilo de la / })
      await user.click(within(group).getAllByRole('button').find((c) => /Estilo Varas/.test(c.textContent ?? '')) as HTMLElement)
    }
    expect(screen.queryByRole('group', { name: /^Atajos de/ })).not.toBeInTheDocument()
  })
})

describe('PizzaBuilderModal no default size and visible auto-advance (S6, S7)', () => {
  const sizeButtons = () => within(screen.getByRole('group', { name: 'Tamaño' })).getAllByRole('button')

  it('opens with no size selected and asks to choose one (S6)', () => {
    const { onAdd } = renderBuilder()
    for (const button of sizeButtons()) expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('list', { name: 'Pasos de la pizza' })).toHaveTextContent(/^Tamaño\s*Pizza/)
    expect(screen.getByRole('list', { name: 'Pasos de la pizza' })).not.toHaveTextContent(/Chica|Grande/)
    expect(screen.getByRole('status', { name: 'Resumen de la pizza' })).toHaveTextContent('Elige el tamaño')
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeDisabled()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('keeps Fijar pizza disabled until a size is chosen (S6, quick pick)', () => {
    renderBuilder(pizzaCatalogFixture, true)
    expect(screen.getByRole('status', { name: 'Resumen de la pizza' })).toHaveTextContent('Elige el tamaño')
    expect(screen.getByRole('button', { name: 'Fijar pizza' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Agregar pizza' })).not.toBeInTheDocument()
  })

  it('shows the chosen size marked when coming back to Tamaño (S6)', async () => {
    const { user, back, card } = renderBuilder()
    await user.click(card('Grande'))
    await back()
    expect(card('Grande')).toHaveAttribute('aria-pressed', 'true')
    expect(card('Chica')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('status', { name: 'Resumen de la pizza' })).toHaveTextContent('Pizza Grande')
  })

  it('unselects a chosen size that sold out instead of replacing it (S6)', async () => {
    const { user, card, view } = renderBuilder()
    await user.click(card('Chica'))
    expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
    view.rerender(<PizzaBuilderModal catalog={withDough(0, 5)} onAdd={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'Tamaño' })).toBeVisible()
    for (const button of sizeButtons()) expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('status', { name: 'Resumen de la pizza' })).toHaveTextContent('Elige el tamaño')
  })

  it('marks the tapped size first and moves to the first portion after the pause (S7)', async () => {
    const { tap, card } = renderBuilder()
    await tap.click(card('Grande'))
    expect(card('Grande')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: 'Tamaño' })).toBeVisible()
    expect(screen.queryByRole('group', { name: /^Estilo de la / })).not.toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS - 100)
    })
    expect(screen.getByRole('group', { name: 'Tamaño' })).toBeVisible()
    await flushAdvance()
    expect(screen.queryByRole('group', { name: 'Tamaño' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
  })

  it('marks a no-choice style first and moves to the next portion after the pause (S7)', async () => {
    const { user, tap, card } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await tap.click(card(/Estilo Varas/))
    expect(card(/Estilo Varas/)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: 'Estilo de la Mitad 1' })).toBeVisible()
    expect(screen.queryByRole('group', { name: 'Estilo de la Mitad 2' })).not.toBeInTheDocument()
    await flushAdvance()
    expect(screen.getByRole('group', { name: 'Estilo de la Mitad 2' })).toBeVisible()
  })

  it('a second size tap during the pause replaces the target and advances once (S7)', async () => {
    const { tap, card } = renderBuilder()
    await tap.click(card('Grande'))
    act(() => {
      vi.advanceTimersByTime(150)
    })
    await tap.click(card('Chica'))
    act(() => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS - 100)
    })
    expect(screen.getByRole('group', { name: 'Tamaño' })).toBeVisible()
    expect(card('Chica')).toHaveAttribute('aria-pressed', 'true')
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
    expect(screen.getByRole('status', { name: 'Resumen de la pizza' })).toHaveTextContent('Pizza Chica')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('going back cancels a pending advance (S7)', async () => {
    const { user, tap, card } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await tap.click(card(/Estilo Varas/))
    await tap.click(screen.getByRole('button', { name: '← Tamaño' }))
    await flushAdvance()
    expect(screen.getByRole('group', { name: 'Tamaño' })).toBeVisible()
    expect(screen.queryByRole('group', { name: /^Estilo de la / })).not.toBeInTheDocument()
  })

  it('closing cancels a pending advance (S7)', async () => {
    const { tap, card, onClose } = renderBuilder()
    await tap.click(card('Grande'))
    await tap.click(screen.getByRole('button', { name: '← Cancelar pizza' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    await flushAdvance()
    expect(screen.getByRole('group', { name: 'Tamaño' })).toBeVisible()
  })

  it('unmounting clears the pending advance without state updates (S7)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { tap, card, view } = renderBuilder()
    await tap.click(card('Grande'))
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    await flushAdvance()
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('changing the division never changes the step and keeps Entera as default (S7)', async () => {
    const { user, tap, card } = renderBuilder()
    await user.click(card('Grande'))
    expect(card('Entera')).toHaveAttribute('aria-pressed', 'true')
    await tap.click(card('Mitades'))
    await flushAdvance()
    expect(card('Mitades')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: 'Estilo de la Mitad 1' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'División' })).toBeVisible()
  })

  it('fixes a quick pizza after the auto-advance (S7, Fijar pizza)', async () => {
    const { user, onAdd, card } = renderBuilder(chicaWhole(), true)
    await user.click(card('Chica'))
    await user.click(card(/Estilo Varas/))
    await user.click(screen.getByRole('button', { name: 'Fijar pizza' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd.mock.calls[0]?.[0].config.size).toBe('chica')
  })
})
