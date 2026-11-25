import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PizzaCatalog, PizzaSize } from '../domain/pizza'
import { pizzaCatalogFixture } from './pizzaCatalogFixture'
import { GHOST_TAP_GUARD_MS, PizzaBuilderModal } from './PizzaBuilderModal'

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

/** Lets the ghost-tap guard after an automatic move pass, so the next tap counts. */
function flushAdvance() {
  return act(() => {
    vi.advanceTimersByTime(GHOST_TAP_GUARD_MS)
  })
}

/** Fake timers plus two clickers: `tap` clicks without waiting; `user.click` also lets the ghost-tap guard pass. */
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

const styleGroup = () => screen.getByRole('group', { name: /^Estilo de la / })
const ingredientsGroup = () => screen.queryByRole('group', { name: 'Ingredientes disponibles' })
const summary = () => screen.getByRole('status', { name: 'Resumen de la pizza' })

function renderBuilder(catalog: PizzaCatalog = pizzaCatalogFixture, quickPick = false) {
  const { tap, user } = advancingUser()
  const onAdd = vi.fn()
  const onClose = vi.fn()
  const view = render(<PizzaBuilderModal catalog={catalog} onAdd={onAdd} onClose={onClose} quickPick={quickPick} />)
  const add = () => user.click(screen.getByRole('button', { name: quickPick ? 'Fijar pizza' : 'Agregar pizza' }))
  const card = (name: RegExp | string) => screen.getByRole('button', { name })
  const tab = (name: RegExp | string) => screen.getByRole('tab', { name })
  /** Picks Estilo Varas on the open portion when it has no style yet. */
  async function pickStyle() {
    const group = screen.queryByRole('group', { name: /^Estilo de la / })
    if (!group) return
    const cards = within(group).getAllByRole('button')
    if (cards.some((c) => c.getAttribute('aria-pressed') === 'true')) return
    await user.click(cards.find((c) => /Estilo Varas/.test(c.textContent ?? '')) ?? (cards[0] as HTMLElement))
  }
  /** Opens the notes disclosure, which starts folded because the notes are optional. */
  async function openNotes() {
    const toggle = screen.queryByRole('button', { name: 'Notas' })
    if (toggle && toggle.getAttribute('aria-expanded') === 'false') await user.click(toggle)
  }
  /** Picks the first available size and a style on every portion, leaving the pizza ready to add. */
  async function readyPizza() {
    const sizes = within(screen.getByRole('group', { name: 'Tamaño' })).getAllByRole('button')
    const alreadyChosen = sizes.some((button) => button.getAttribute('aria-pressed') === 'true')
    const pickable = sizes.find((button) => !(button as HTMLButtonElement).disabled)
    if (!alreadyChosen && pickable) await user.click(pickable)
    const tabs = screen.queryAllByRole('tab')
    for (let at = 0; at < Math.max(tabs.length, 1); at += 1) {
      const tabAt = screen.queryAllByRole('tab')[at]
      if (tabAt) await user.click(tabAt)
      await pickStyle()
    }
  }
  return { onAdd, onClose, user, tap, view, add, card, tab, pickStyle, openNotes, readyPizza }
}

const MEXICANA = { id: 'mex', name: 'Estilo Mexicana', description: '', kind: 'special', includedIngredients: 0, sortOrder: 3 } as const
const CUSTOM_ONLY: PizzaCatalog = { ...pizzaCatalogFixture, styles: pizzaCatalogFixture.styles.filter((s) => s.id === 'custom') }

describe('PizzaBuilderModal single screen (S1-S3, S5, S6)', () => {
  it('shows size, division and the portion on one screen with no step navigation', async () => {
    const { user, card } = renderBuilder()
    expect(screen.getByRole('group', { name: 'Tamaño' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Siguiente/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Pasos de la pizza' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^←/ })).not.toBeInTheDocument()

    await user.click(card('Grande'))
    // Choosing a size does not navigate anywhere: the size stays on screen next to everything it enables.
    expect(screen.getByRole('group', { name: 'Tamaño' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'División' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Siguiente/ })).not.toBeInTheDocument()
  })

  it('keeps extras, quantity, summary and the add button on screen from the start', () => {
    renderBuilder()
    expect(screen.getByRole('group', { name: 'Extras para toda la pizza' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Cantidad de pizzas' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeVisible()
    expect(summary()).toHaveTextContent('Elige el tamaño')
  })

  it('opens with no size selected and asks to choose one (S6)', () => {
    const { onAdd } = renderBuilder()
    const sizes = within(screen.getByRole('group', { name: 'Tamaño' })).getAllByRole('button')
    for (const button of sizes) expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('group', { name: /^Estilo de la / })).not.toBeInTheDocument()
    expect(summary()).toHaveTextContent('Elige el tamaño')
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeDisabled()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('closes without adding from the modal close button', async () => {
    const { user, onClose, onAdd } = renderBuilder()
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onAdd).not.toHaveBeenCalled()
  })
})

describe('PizzaBuilderModal portion tabs', () => {
  it('has no tab strip on a whole pizza', async () => {
    const { user, card } = renderBuilder()
    await user.click(card('Chica'))
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
  })

  it('shows one tab per portion with its style as the subtitle', async () => {
    const { user, card, tab } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    expect(within(screen.getByRole('tablist', { name: 'Porciones de la pizza' })).getAllByRole('tab')).toHaveLength(2)
    expect(tab(/Mitad 1/)).toHaveTextContent('Sin estilo')
    expect(tab(/Mitad 2/)).toHaveTextContent('Sin estilo')

    await user.click(card(/Estilo Varas/))
    expect(tab(/Mitad 1/)).toHaveTextContent('Varas')
    expect(tab(/Mitad 1/)).toHaveAttribute('aria-selected', 'false')
    expect(tab(/Mitad 2/)).toHaveAttribute('aria-selected', 'true')
  })

  it('shows only the active portion and switches with one tap on a tab', async () => {
    const { user, card, tab } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    expect(screen.getByRole('group', { name: 'Estilo de la Mitad 1' })).toBeVisible()
    expect(screen.queryByRole('group', { name: 'Estilo de la Mitad 2' })).not.toBeInTheDocument()

    await user.click(tab(/Mitad 2/))
    expect(screen.getByRole('group', { name: 'Estilo de la Mitad 2' })).toBeVisible()
    expect(screen.queryByRole('group', { name: 'Estilo de la Mitad 1' })).not.toBeInTheDocument()

    await user.click(tab(/Mitad 1/))
    expect(screen.getByRole('group', { name: 'Estilo de la Mitad 1' })).toBeVisible()
  })

  it('reaches every portion with the arrow keys', async () => {
    const { user, card } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Tercios'))
    expect(screen.getByRole('group', { name: 'Estilo de la Porción 1' })).toBeVisible()

    await user.click(screen.getByRole('tab', { name: /Porción 1/ }))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('group', { name: 'Estilo de la Porción 2' })).toBeVisible()

    await user.keyboard('{End}')
    expect(screen.getByRole('group', { name: 'Estilo de la Porción 3' })).toBeVisible()

    await user.keyboard('{Home}')
    expect(screen.getByRole('group', { name: 'Estilo de la Porción 1' })).toBeVisible()
  })

  it('names the third portions Porción 3', async () => {
    const { user, card, pickStyle, openNotes } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Tercios'))
    await pickStyle()
    await pickStyle()
    await pickStyle()
    await openNotes()
    expect(screen.getByLabelText('Porción 3 · Varas')).toBeVisible()
  })

  it('needs no way back to a portion the style moved past: its tab is one tap away', async () => {
    const { onAdd, user, card, tab, add, openNotes } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await user.click(card(/Estilo Varas/))
    expect(tab(/Mitad 2/)).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: /Extras en Mitad 1/ })).not.toBeInTheDocument()

    // Back to the first half in one tap and charge an extra ingredient there.
    await user.click(tab(/Mitad 1/))
    await user.click(within(ingredientsGroup() as HTMLElement).getByRole('button', { name: 'Jalapeños' }))
    await user.click(tab(/Mitad 2/))
    await user.click(card(/Estilo Varas/))
    await add()
    expect(onAdd.mock.calls[0]?.[0].config.portions).toEqual([
      { styleId: 'varas', ingredientIds: [], extraIngredientIds: ['jal'] },
      { styleId: 'varas', ingredientIds: [], extraIngredientIds: [] },
    ])
    expect(openNotes).toBeTypeOf('function')
  })
})

describe('PizzaBuilderModal size and pizza dough', () => {
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
    const { onAdd, readyPizza, card, add } = renderBuilder(withDough(0, 5))
    expect(card(/Chica/)).toBeDisabled()
    await readyPizza()
    await add()
    expect(onAdd.mock.calls[0]?.[0].config.size).toBe('grande')
  })

  it('shows how many doughs remain for a limited size and nothing for an unlimited one', () => {
    renderBuilder(withDough(3, null))
    expect(within(screen.getByRole('button', { name: /Chica/ })).getByText('Quedan 3')).toBeVisible()
    expect(screen.queryByText('Agotado')).not.toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /Grande/ })).queryByText(/Quedan/)).not.toBeInTheDocument()
  })

  it('blocks adding when every size is sold out', () => {
    renderBuilder(withDough(0, 0))
    expect(screen.getByText('No hay masas de pizza disponibles.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeDisabled()
    expect(screen.getAllByText('Agotado')).toHaveLength(2)
  })

  it('keeps the chosen size marked and everything chosen when another size is tapped', async () => {
    const { user, card } = renderBuilder()
    await user.click(card('Chica'))
    await user.click(card(/Estilo Varas/))
    expect(card('Chica')).toHaveAttribute('aria-pressed', 'true')
    await user.click(card('Grande'))
    expect(card('Grande')).toHaveAttribute('aria-pressed', 'true')
    expect(card(/Estilo Varas/)).toHaveAttribute('aria-pressed', 'true')
    expect(summary()).toHaveTextContent('Pizza Grande · Varas')
  })

  it('unselects a chosen size that sold out instead of replacing it (S6)', async () => {
    const { user, card, view } = renderBuilder()
    await user.click(card('Chica'))
    expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
    view.rerender(<PizzaBuilderModal catalog={withDough(0, 5)} onAdd={vi.fn()} onClose={vi.fn()} />)
    const sizes = within(screen.getByRole('group', { name: 'Tamaño' })).getAllByRole('button')
    for (const button of sizes) expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(summary()).toHaveTextContent('Elige el tamaño')
  })
})

describe('PizzaBuilderModal division', () => {
  it('starts as Entera and offers only the divisions the size allows', async () => {
    const { user, card } = renderBuilder()
    await user.click(card('Grande'))
    const division = screen.getByRole('group', { name: 'División' })
    expect(within(division).getAllByRole('button').map((button) => button.textContent)).toEqual(['Entera', 'Mitades', 'Tercios', 'Cuartos'])
    expect(within(division).getByRole('button', { name: 'Entera' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows no division selector when the size only allows a whole pizza', async () => {
    const { user, card } = renderBuilder(chicaWhole())
    await user.click(card('Chica'))
    expect(screen.queryByRole('group', { name: 'División' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
  })

  it('adds and removes portion tabs keeping the styles already chosen', async () => {
    const { user, card } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card(/Arma tu combinación/))
    await user.click(within(ingredientsGroup() as HTMLElement).getByRole('button', { name: 'Piña' }))
    await user.click(card('Mitades'))
    expect(within(screen.getByRole('tablist')).getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByRole('group', { name: 'Estilo de la Mitad 1' })).toBeVisible()
    expect(card(/Arma tu combinación/)).toHaveAttribute('aria-pressed', 'true')
    expect(within(ingredientsGroup() as HTMLElement).getByRole('button', { name: 'Piña' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(card('Entera'))
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
  })

  it('falls back to Entera when another size does not allow the current division', async () => {
    const { user, card } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Cuartos'))
    await user.click(card('Chica'))
    expect(card('Entera')).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByRole('group', { name: 'División' })).queryByRole('button', { name: 'Cuartos' })).not.toBeInTheDocument()
  })

  it('keeps the pizza extras when the division changes', async () => {
    const { onAdd, user, add, card, readyPizza } = renderBuilder()
    await user.click(card('Chica'))
    await user.click(screen.getByRole('checkbox', { name: 'Extra queso' }))
    await user.click(card('Mitades'))
    await readyPizza()
    await add()
    expect(onAdd.mock.calls[0]?.[0].config.extraIds).toEqual(['queso'])
  })
})

describe('PizzaBuilderModal styles', () => {
  it('starts a portion with no style and no ingredient controls', async () => {
    const { user, card } = renderBuilder()
    await user.click(card('Chica'))
    const cards = within(styleGroup()).getAllByRole('button')
    expect(cards).toHaveLength(2)
    for (const styleCard of cards) expect(styleCard).toHaveAttribute('aria-pressed', 'false')
    expect(ingredientsGroup()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cambiar estilo' })).not.toBeInTheDocument()
  })

  it('blocks adding with a hint until every portion has a style', async () => {
    const { onAdd, user, card } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeDisabled()
    expect(screen.getByText('Elige el estilo de la mitad 1')).toBeVisible()

    await user.click(card(/Estilo Varas/))
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeDisabled()
    expect(screen.getByText('Elige el estilo de la mitad 2')).toBeVisible()
    expect(summary()).toHaveTextContent('Mitad Varas / Mitad 2 sin estilo')

    await user.click(card(/Estilo Varas/))
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeEnabled()
    expect(screen.queryByText(/Elige el estilo de la mitad/)).not.toBeInTheDocument()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('hides the other styles once one is chosen and keeps its ingredients right below', async () => {
    const { user, card } = renderBuilder(CUSTOM_ONLY)
    await user.click(card('Chica'))
    await user.click(card(/Arma tu combinación/))
    const cards = within(styleGroup()).getAllByRole('button')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('Arma tu combinación')
    expect(cards[0]).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Cambiar estilo' })).toBeVisible()
    expect(screen.getByText('Incluye 2 ingredientes a elección · Doble cuenta como extra')).toBeVisible()
  })

  it('Cambiar estilo shows the list again; another style resets the ingredients', async () => {
    const { user, card } = renderBuilder()
    await user.click(card('Chica'))
    await user.click(card(/Arma tu combinación/))
    await user.click(within(ingredientsGroup() as HTMLElement).getByRole('button', { name: 'Piña' }))
    await user.click(screen.getByRole('button', { name: 'Cambiar estilo' }))
    expect(within(styleGroup()).getAllByRole('button')).toHaveLength(2)
    await user.click(card(/Estilo Varas/))
    expect(within(styleGroup()).getAllByRole('button')).toHaveLength(1)
    expect(screen.getByText(/no incluye ingredientes/i)).toBeVisible()
    expect(screen.queryByRole('group', { name: 'Cantidad de Piña' })).not.toBeInTheDocument()
  })

  it('shows a portion that already has a style collapsed when coming back to its tab', async () => {
    const { user, card, tab } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await user.click(card(/Arma tu combinación/))
    await user.click(within(ingredientsGroup() as HTMLElement).getByRole('button', { name: 'Piña' }))
    await user.click(tab(/Mitad 2/))
    expect(within(styleGroup()).getAllByRole('button')).toHaveLength(2)
    await user.click(tab(/Mitad 1/))
    expect(within(styleGroup()).getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Cambiar estilo' })).toBeVisible()
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
    const cards = within(styleGroup()).getAllByRole('button')
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining('Estilo Pepperoni'),
      expect.stringContaining('Estilo Hawaiana'),
      expect.stringContaining('Arma tu combinación'),
      expect.stringContaining('Estilo Varas'),
    ])
    for (const styleCard of cards) expect(styleCard).toHaveAttribute('aria-pressed', 'false')
  })

  it('lets Estilo Mexicana pick one or two chiles, starting on the 3 chiles', async () => {
    const catalog: PizzaCatalog = { ...pizzaCatalogFixture, styles: [...pizzaCatalogFixture.styles, MEXICANA] }
    const { onAdd, user, add, card } = renderBuilder(catalog)
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
})

describe('PizzaBuilderModal moving on by itself (S4, S7)', () => {
  it('moves to the next portion in the same tap when the style has no ingredients to choose', async () => {
    const { tap, user, card, tab } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await tap.click(card(/Estilo Varas/))
    expect(tab(/Mitad 2/)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('group', { name: 'Estilo de la Mitad 2' })).toBeVisible()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stays on its portion when the style has ingredients to choose', async () => {
    const { user, card, tab } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await user.click(card(/Arma tu combinación/))
    expect(tab(/Mitad 1/)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('group', { name: 'Estilo de la Mitad 1' })).toBeVisible()
    expect(ingredientsGroup()).toBeVisible()
  })

  it('stays on its portion when the style has a chile choice', async () => {
    const catalog: PizzaCatalog = { ...pizzaCatalogFixture, styles: [...pizzaCatalogFixture.styles, MEXICANA] }
    const { user, card, tab } = renderBuilder(catalog)
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await user.click(card(/Estilo Mexicana/))
    expect(tab(/Mitad 1/)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('group', { name: 'Chile (elige uno o dos)' })).toBeVisible()
  })

  it('does not move when only the ingredients of the chosen style are changed', async () => {
    const { user, card, tab } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await user.click(card(/Estilo Varas/))
    await user.click(tab(/Mitad 1/))
    await user.click(within(ingredientsGroup() as HTMLElement).getByRole('button', { name: 'Jalapeños' }))
    expect(tab(/Mitad 1/)).toHaveAttribute('aria-selected', 'true')
  })

  it('ignores a quick second tap on the content the move reached, then accepts taps after the guard', async () => {
    const { tap, card } = renderBuilder()
    await tap.click(card('Grande'))
    await tap.click(card(/Estilo Varas/))
    expect(card(/Estilo Varas/)).toHaveAttribute('aria-pressed', 'false')
    act(() => {
      vi.advanceTimersByTime(100)
    })
    await tap.click(card(/Estilo Varas/))
    expect(card(/Estilo Varas/)).toHaveAttribute('aria-pressed', 'false')
    act(() => {
      vi.advanceTimersByTime(GHOST_TAP_GUARD_MS)
    })
    await tap.click(card(/Estilo Varas/))
    expect(card(/Estilo Varas/)).toHaveAttribute('aria-pressed', 'true')
  })

  it('a quick second tap after the size does not change the division', async () => {
    const { tap, card } = renderBuilder()
    await tap.click(card('Grande'))
    await tap.click(card('Mitades'))
    expect(card('Entera')).toHaveAttribute('aria-pressed', 'true')
    expect(card('Mitades')).toHaveAttribute('aria-pressed', 'false')
  })

  it('a quick second tap after a no-choice style does not pick on the next portion', async () => {
    const { user, tap, card, tab } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await tap.click(card(/Estilo Varas/))
    await tap.click(card(/Estilo Varas/))
    expect(tab(/Mitad 2/)).toHaveAttribute('aria-selected', 'true')
    expect(card(/Estilo Varas/)).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('PizzaBuilderModal ingredients', () => {
  const chips = () => ingredientsGroup() as HTMLElement
  const level = (name: string, option: 'Normal' | 'Doble' | 'Quitar') =>
    within(screen.getByRole('group', { name: `Cantidad de ${name}` })).getByRole('button', { name: option })

  it('shows the real included count in the legend', async () => {
    const { user, card } = renderBuilder(CUSTOM_ONLY)
    await user.click(card('Chica'))
    await user.click(card(/Arma tu combinación/))
    expect(screen.getByText('Incluye 2 ingredientes a elección · Doble cuenta como extra')).toBeVisible()
  })

  it('has no separate ingredients step: the ingredients sit under the style', async () => {
    const { user, card } = renderBuilder(CUSTOM_ONLY)
    await user.click(card('Chica'))
    await user.click(card(/Arma tu combinación/))
    await user.click(within(chips()).getByRole('button', { name: 'Piña' }))
    expect(screen.getByRole('group', { name: 'Cantidad de Piña' })).toBeVisible()
    expect(card(/Arma tu combinación/)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /^Siguiente/ })).not.toBeInTheDocument()
  })

  it('requires at least one ingredient for the custom style and keeps extras beyond the limit charged', async () => {
    const { onAdd, user, add, card } = renderBuilder(CUSTOM_ONLY)
    await user.click(card('Chica'))
    await user.click(card(/Arma tu combinación/))
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
    const { onAdd, user, add, card } = renderBuilder(CUSTOM_ONLY)
    await user.click(card('Chica'))
    await user.click(card(/Arma tu combinación/))
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
    const { onAdd, user, add, card } = renderBuilder()
    await user.click(card('Chica'))
    await user.click(card(/Estilo Varas/))
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
    const { onAdd, user, add, card } = renderBuilder(catalog)
    await user.click(card('Chica'))
    await user.click(card(/Estilo Varas/))
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeEnabled()
    await user.click(within(chips()).getByRole('button', { name: 'Pepperoni' }))
    await user.click(within(chips()).getByRole('button', { name: 'Jalapeños' }))
    await add()
    expect(onAdd.mock.calls[0]?.[0].name).toBe('Pizza Chica: Estilo Varas (Jalapeños, Pepperoni)')
  })

  it('configures each portion on its own tab', async () => {
    const { onAdd, user, add, card, tab } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await user.click(card(/Estilo Varas/))
    await user.click(card(/Estilo Varas/))
    await user.click(within(chips()).getByRole('button', { name: 'Jalapeños' }))
    await user.click(tab(/Mitad 1/))
    expect(within(chips()).getByRole('button', { name: 'Jalapeños' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(tab(/Mitad 2/))
    expect(within(chips()).getByRole('button', { name: 'Jalapeños' })).toHaveAttribute('aria-pressed', 'true')
    await add()
    expect(onAdd.mock.calls[0]?.[0].config.portions).toEqual([
      { styleId: 'varas', ingredientIds: [], extraIngredientIds: [] },
      { styleId: 'varas', ingredientIds: [], extraIngredientIds: ['jal'] },
    ])
  })

  it('lists ingredients alphabetically', async () => {
    const { user, card } = renderBuilder()
    await user.click(card('Chica'))
    await user.click(card(/Estilo Varas/))
    expect(within(chips()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Jalapeños', 'Pepperoni', 'Piña'])
  })
})

describe('PizzaBuilderModal extras', () => {
  it('lists the extras alphabetically and applies them to the whole pizza', async () => {
    const { onAdd, user, add, card } = renderBuilder()
    await user.click(card('Chica'))
    await user.click(card(/Estilo Varas/))
    const extras = screen.getByRole('group', { name: 'Extras para toda la pizza' })
    expect(within(extras).getAllByRole('checkbox').map((b) => b.parentElement?.textContent)).toEqual(['Extra queso', 'Orilla rellena'])
    await user.click(within(extras).getByRole('checkbox', { name: 'Orilla rellena' }))
    await user.click(within(extras).getByRole('checkbox', { name: 'Extra queso' }))
    expect(summary()).toHaveTextContent('Extra queso, Orilla rellena')
    await add()
    expect(onAdd.mock.calls[0]?.[0].config.extraIds).toEqual(['orilla', 'queso'])
  })

  it('hides the extras group when the catalog has no extras', () => {
    renderBuilder({ ...pizzaCatalogFixture, extras: [] })
    expect(screen.queryByRole('group', { name: 'Extras para toda la pizza' })).not.toBeInTheDocument()
  })

  it('shows the extras while a portion is still missing its style', () => {
    renderBuilder()
    expect(screen.getByRole('group', { name: 'Extras para toda la pizza' })).toBeVisible()
  })
})

describe('PizzaBuilderModal adding', () => {
  it('adds a whole special pizza with its description and note', async () => {
    const { onAdd, user, add, card, openNotes } = renderBuilder()
    await user.click(card('Chica'))
    await user.click(card(/Estilo Varas/))
    expect(summary()).toHaveTextContent('Pizza Chica · Varas')
    await openNotes()
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
    const { onAdd, onClose, user, add, readyPizza } = renderBuilder()
    await readyPizza()
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
    const { user, readyPizza } = renderBuilder()
    await readyPizza()
    const group = screen.getByRole('group', { name: 'Cantidad de pizzas' })
    for (let i = 0; i < 25; i++) {
      const more = within(group).getByRole('button', { name: 'Más' })
      if (!(more as HTMLButtonElement).disabled) await user.click(more)
    }
    expect(within(group).getByText('×20')).toBeVisible()
    expect(within(group).getByRole('button', { name: 'Más' })).toBeDisabled()
  })

  it('shows a live summary with size, portions and extras', async () => {
    const { user, card, readyPizza } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await readyPizza()
    await user.click(screen.getByRole('checkbox', { name: 'Extra queso' }))
    expect(summary()).toHaveTextContent('Pizza Grande · Mitad Varas / Mitad Varas · Extra queso')
  })

  it('adds an entera pizza with a style without ingredient choices in 3 taps', async () => {
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
})

describe('PizzaBuilderModal notes', () => {
  it('starts folded because the notes are optional', async () => {
    const { user, card, openNotes } = renderBuilder()
    await user.click(card('Chica'))
    const toggle = screen.getByRole('button', { name: 'Notas' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText(/nota de la pizza/i)).not.toBeInTheDocument()
    await openNotes()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText(/nota de la pizza/i)).toBeVisible()
  })

  it('shows a note per portion labelled with the portion and its style, before the pizza note', async () => {
    const { user, card, pickStyle, openNotes } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await pickStyle()
    await pickStyle()
    await openNotes()
    expect(screen.getByLabelText('Mitad 1 · Varas')).toBeVisible()
    expect(screen.getByLabelText('Mitad 2 · Varas')).toBeVisible()
    expect(screen.queryByText('Notas por porción')).not.toBeInTheDocument()
    const first = screen.getByLabelText('Mitad 1 · Varas')
    const pizzaNote = screen.getByLabelText(/nota de la pizza/i)
    expect(first.compareDocumentPosition(pizzaNote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('adds the pizza with trimmed portion notes and drops a blank one, keeping the pizza note apart', async () => {
    const { onAdd, user, add, card, pickStyle, openNotes } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await pickStyle()
    await pickStyle()
    await openNotes()
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
    const { user, card, openNotes } = renderBuilder()
    await user.click(card('Chica'))
    await openNotes()
    expect(screen.getByLabelText(/nota de la pizza/i)).toHaveAttribute('maxlength')
    expect(screen.getByLabelText(/nota de la pizza/i)).toHaveAttribute('maxlength', '200')
  })

  it('shows no portion notes on a whole pizza', async () => {
    const { user, card, openNotes } = renderBuilder()
    await user.click(card('Chica'))
    await openNotes()
    expect(screen.queryByLabelText(/^Mitad /)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/nota de la pizza/i)).toBeVisible()
  })

  it('drops the portion notes when the division goes back to a whole pizza', async () => {
    const { onAdd, user, add, card, pickStyle, openNotes } = renderBuilder()
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await pickStyle()
    await pickStyle()
    await openNotes()
    await user.type(screen.getByLabelText('Mitad 1 · Varas'), 'sin piña')
    await user.click(card('Entera'))
    expect(screen.queryByLabelText(/^Mitad /)).not.toBeInTheDocument()
    await add()
    expect(onAdd.mock.calls[0]![0].config.portions).toEqual([{ styleId: 'varas', ingredientIds: [], extraIngredientIds: [] }])
  })
})

describe('PizzaBuilderModal note shortcuts', () => {
  const shortcuts = ['Sin cebolla', 'Bien cocida']

  async function halves(options: { shortcuts?: string[] } = {}) {
    const onAdd = vi.fn()
    render(
      <PizzaBuilderModal catalog={pizzaCatalogFixture} onAdd={onAdd} onClose={vi.fn()} noteShortcuts={options.shortcuts ?? shortcuts} />,
    )
    const { user } = advancingUser()
    await user.click(screen.getByRole('button', { name: 'Grande' }))
    await user.click(screen.getByRole('button', { name: 'Mitades' }))
    for (let i = 0; i < 2; i++) {
      await user.click(
        within(screen.getByRole('group', { name: /^Estilo de la / }))
          .getAllByRole('button')
          .find((c) => /Estilo Varas/.test(c.textContent ?? '')) as HTMLElement,
      )
    }
    await user.click(screen.getByRole('button', { name: 'Notas' }))
    return { onAdd, user }
  }

  it('shows toggle chips under each portion note and under the pizza note', async () => {
    await halves()
    for (const name of ['Atajos de Mitad 1 · Varas', 'Atajos de Mitad 2 · Varas', 'Atajos de notas de la pizza']) {
      const group = screen.getByRole('group', { name })
      expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(shortcuts)
      for (const chip of within(group).getAllByRole('button')) expect(chip).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('appends a tapped shortcut to that note only, joined with ", ", and removes it on a second tap', async () => {
    const { user } = await halves()
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
    const { onAdd, user } = await halves()
    const half2 = screen.getByRole('group', { name: 'Atajos de Mitad 2 · Varas' })
    await user.click(within(half2).getByRole('button', { name: 'Bien cocida' }))
    await user.type(screen.getByLabelText('Mitad 2 · Varas'), ' y crujiente')
    const pizzaGroup = screen.getByRole('group', { name: 'Atajos de notas de la pizza' })
    await user.click(within(pizzaGroup).getByRole('button', { name: 'Sin cebolla' }))
    expect(screen.getByLabelText(/nota de la pizza/i)).toHaveValue('Sin cebolla')
    await user.click(screen.getByRole('button', { name: 'Agregar pizza' }))
    const built = onAdd.mock.calls[0]![0]
    expect(built.notes).toBe('Sin cebolla')
    expect(built.config.portions[1]?.note).toBe('Bien cocida y crujiente')
    expect(built.config.portions[0]?.note).toBeUndefined()
  })

  it('does not append past the 80-character portion limit: the chip is disabled and the note stays', async () => {
    const { user } = await halves({ shortcuts: ['Sin cebolla'] })
    const note = screen.getByLabelText('Mitad 1 · Varas')
    await user.type(note, 'x'.repeat(75))
    const chip = within(screen.getByRole('group', { name: 'Atajos de Mitad 1 · Varas' })).getByRole('button', { name: 'Sin cebolla' })
    expect(chip).toBeDisabled()
    await user.click(chip)
    expect(note).toHaveValue('x'.repeat(75))
  })

  it('shows no chips when there are no shortcuts', async () => {
    await halves({ shortcuts: [] })
    expect(screen.queryByRole('group', { name: /^Atajos de/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Mitad 1 · Varas')).toBeVisible()
  })
})

describe('PizzaBuilderModal quick pizza (Fijar pizza)', () => {
  it('fixes a quick pizza without quantity, notes or portion notes', async () => {
    const { onAdd, user, card } = renderBuilder(pizzaCatalogFixture, true)
    expect(screen.getByRole('status', { name: 'Resumen de la pizza' })).toHaveTextContent('Elige el tamaño')
    expect(screen.getByRole('button', { name: 'Fijar pizza' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Agregar pizza' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Cantidad de pizzas' })).not.toBeInTheDocument()

    await user.click(card('Grande'))
    await user.click(card(/Estilo Varas/))
    expect(screen.queryByRole('button', { name: 'Notas' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fijar pizza' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Fijar pizza' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd.mock.calls[0]?.[0].config.size).toBe('grande')
  })

  it('fixes a quick pizza with halves and no notes', async () => {
    const { onAdd, user, card, tab } = renderBuilder(pizzaCatalogFixture, true)
    await user.click(card('Grande'))
    await user.click(card('Mitades'))
    await user.click(card(/Estilo Varas/))
    expect(tab(/Mitad 2/)).toHaveAttribute('aria-selected', 'true')
    await user.click(card(/Estilo Varas/))
    expect(screen.queryByRole('button', { name: 'Notas' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Fijar pizza' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd.mock.calls[0]?.[0].config.portions).toHaveLength(2)
  })
})
