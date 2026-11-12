import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PizzaCatalog, PizzaSize } from '../domain/pizza'
import { pizzaCatalogFixture } from './pizzaCatalogFixture'
import { PizzaBuilderModal } from './PizzaBuilderModal'

function withDough(chica: number | null, grande: number | null): PizzaCatalog {
  const [first, second] = pizzaCatalogFixture.sizes as [PizzaSize, PizzaSize]
  return { ...pizzaCatalogFixture, sizes: [{ ...first, doughLeft: chica }, { ...second, doughLeft: grande }] }
}

/** Chica can only be a whole pizza, like the real catalog. */
function chicaWhole(catalog: PizzaCatalog = pizzaCatalogFixture): PizzaCatalog {
  const [first, ...rest] = catalog.sizes as [PizzaSize, ...PizzaSize[]]
  return { ...catalog, sizes: [{ ...first, allowedPortions: [1] }, ...rest] }
}

function renderBuilder(catalog: PizzaCatalog = pizzaCatalogFixture) {
  const onAdd = vi.fn()
  const onClose = vi.fn()
  render(<PizzaBuilderModal catalog={catalog} onAdd={onAdd} onClose={onClose} />)
  const user = userEvent.setup()
  const next = () => user.click(screen.getByRole('button', { name: /^Siguiente/ }))
  const back = () => user.click(screen.getByRole('button', { name: /^←/ }))
  const add = () => user.click(screen.getByRole('button', { name: 'Agregar pizza' }))
  const card = (name: RegExp | string) => screen.getByRole('button', { name })
  /** Walks size → (division) → style until the ingredients step. */
  async function toIngredients() {
    while (!screen.queryByRole('button', { name: 'Agregar pizza' })) await next()
  }
  return { onAdd, onClose, user, next, back, add, card, toIngredients }
}

const MEXICANA = { id: 'mex', name: 'Estilo Mexicana', description: '', kind: 'special', includedIngredients: 0, sortOrder: 3 } as const
const CUSTOM_ONLY: PizzaCatalog = { ...pizzaCatalogFixture, styles: pizzaCatalogFixture.styles.filter((s) => s.id === 'custom') }

describe('PizzaBuilderModal steps', () => {
  it('goes Tamaño → División → one step per portion with a header of completed choices', async () => {
    const { user, next, card } = renderBuilder()
    const steps = screen.getByRole('list', { name: 'Pasos de la pizza' })
    expect(screen.getByRole('group', { name: 'Tamaño' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Agregar pizza' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '← Cancelar pizza' })).toBeVisible()

    await user.click(card('Grande'))
    await next()
    expect(screen.getByRole('group', { name: 'División' })).toBeVisible()
    expect(steps).toHaveTextContent(/Tamaño ✓\s*Grande/)
    await user.click(card('Mitades'))
    await next()
    expect(screen.getByRole('group', { name: 'Estilo de la Mitad 1' })).toBeVisible()
    expect(steps).toHaveTextContent(/División ✓\s*Mitades/)
    expect(screen.getByRole('group', { name: 'Ingredientes disponibles' })).toBeVisible()
    await next()
    expect(screen.getByRole('group', { name: 'Estilo de la Mitad 2' })).toBeVisible()
    expect(steps).toHaveTextContent(/Mitad 1 ✓\s*Varas/)
    expect(screen.getByRole('group', { name: 'Ingredientes disponibles' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeVisible()
  })

  it('has no separate Ingredientes step: the ingredients are on the style step', async () => {
    const { user, next, card } = renderBuilder(CUSTOM_ONLY)
    expect(screen.queryByRole('list', { name: 'Pasos de la pizza' })).toHaveTextContent(/Tamaño/)
    expect(screen.getByRole('list', { name: 'Pasos de la pizza' })).not.toHaveTextContent('Ingredientes')
    await next()
    await next()
    expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Ingredientes disponibles' })).toBeVisible()
    await user.click(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Piña' }))
    expect(screen.getByRole('group', { name: 'Cantidad de Piña' })).toBeVisible()
    expect(card(/Arma tu combinación/)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /Siguiente: Ingredientes/ })).not.toBeInTheDocument()
  })

  it('preselects the default style, so its ingredient controls show right away', async () => {
    const { next } = renderBuilder(CUSTOM_ONLY)
    await next()
    await next()
    expect(screen.getByRole('button', { name: /Arma tu combinación/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Incluye 2 ingredientes a elección · Doble cuenta como extra')).toBeVisible()
  })

  it('shows the ingredients of the newly chosen style and resets them to its defaults', async () => {
    const { user, next, card } = renderBuilder()
    await next()
    await next()
    expect(screen.getByText(/no incluye ingredientes/i)).toBeVisible()
    await user.click(card(/Arma tu combinación/))
    expect(screen.getByText('Incluye 2 ingredientes a elección · Doble cuenta como extra')).toBeVisible()
    await user.click(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Piña' }))
    await user.click(screen.getByRole('button', { name: 'Cambiar estilo' }))
    await user.click(card(/Estilo Varas/))
    expect(screen.getByText(/no incluye ingredientes/i)).toBeVisible()
    expect(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Piña' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('goes Tamaño → Pizza for a whole pizza, adding from that step', async () => {
    const { onAdd, user, next, add } = renderBuilder(chicaWhole())
    await next()
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
    await next()
    await user.click(card('Mitades'))
    await next()
    expect(screen.getByRole('button', { name: 'Siguiente: Mitad 2 →' })).toBeVisible()
    expect(screen.queryByRole('group', { name: 'Extras para toda la pizza' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/nota de la pizza/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Cantidad de pizzas' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agregar pizza' })).not.toBeInTheDocument()
    await next()
    expect(screen.getByRole('group', { name: 'Extras para toda la pizza' })).toBeVisible()
    expect(screen.getByLabelText(/nota de la pizza/i)).toBeVisible()
    expect(screen.getByRole('group', { name: 'Cantidad de pizzas' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Siguiente/ })).not.toBeInTheDocument()
  })

  it('blocks Siguiente on a custom portion without ingredients and shows the error there', async () => {
    const { user, next, card } = renderBuilder(CUSTOM_ONLY)
    await user.click(card('Grande'))
    await next()
    await user.click(card('Mitades'))
    await next()
    expect(screen.getByRole('button', { name: /^Siguiente/ })).toBeDisabled()
    expect(screen.getByText(/elige al menos un ingrediente/i)).toBeVisible()
    await user.click(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Pepperoni' }))
    expect(screen.getByRole('button', { name: /^Siguiente/ })).toBeEnabled()
    await next()
    expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeDisabled()
    expect(screen.getByText(/elige al menos un ingrediente/i)).toBeVisible()
  })

  it('skips División when the size only allows a whole pizza', async () => {
    const { next } = renderBuilder(chicaWhole())
    expect(screen.getByRole('button', { name: 'Siguiente: Pizza →' })).toBeVisible()
    await next()
    expect(screen.queryByRole('group', { name: 'División' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).toBeVisible()
  })

  it('labels the next button with the portion that follows', async () => {
    const { user, next, card } = renderBuilder()
    await user.click(card('Grande'))
    await next()
    await user.click(card('Mitades'))
    await next()
    expect(screen.getByRole('button', { name: 'Siguiente: Mitad 2 →' })).toBeVisible()
  })

  it('shows a diagram that names the portion being edited', async () => {
    const { user, next, card } = renderBuilder()
    await user.click(card('Grande'))
    await next()
    await user.click(card('Tercios'))
    await next()
    expect(screen.getByRole('img', { name: /Tercios.*Porción 1/ })).toBeVisible()
    await next()
    expect(screen.getByRole('img', { name: /Tercios.*Porción 2/ })).toBeVisible()
  })

  it('lets the style be chosen from cards with name and description, per portion', async () => {
    const { onAdd, user, next, card, add } = renderBuilder()
    await user.click(card('Grande'))
    await next()
    await user.click(card('Mitades'))
    await next()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(card(/Estilo Varas/)).toHaveTextContent('Pepperoni y queso')
    expect(card(/Estilo Varas/)).toHaveAttribute('aria-pressed', 'true')
    expect(card(/Arma tu combinación/)).toHaveAttribute('aria-pressed', 'false')
    await next()
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
    const { user, next, back, card, onClose } = renderBuilder()
    await user.click(card('Grande'))
    await next()
    await user.click(card('Cuartos'))
    await next()
    await user.click(card(/Arma tu combinación/))
    await back()
    expect(screen.getByRole('group', { name: 'División' })).toBeVisible()
    expect(card('Cuartos')).toHaveAttribute('aria-pressed', 'true')
    await back()
    expect(card('Grande')).toHaveAttribute('aria-pressed', 'true')
    await next()
    await next()
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
    await ctx.next()
    await ctx.user.click(ctx.card('Mitades'))
    await ctx.next()
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
    const { user, card } = await toFirstPortion()
    await user.click(card(/Arma tu combinación/))
    await user.click(within(screen.getByRole('group', { name: 'Ingredientes disponibles' })).getByRole('button', { name: 'Piña' }))
    await user.click(screen.getByRole('button', { name: 'Cambiar estilo' }))
    expect(within(styleGroup('Estilo de la Mitad 1')).getAllByRole('button')).toHaveLength(2)
    expect(card(/Arma tu combinación/)).toHaveAttribute('aria-pressed', 'true')
    await user.click(card(/Estilo Varas/))
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
    const { user, next, card } = renderBuilder(catalog)
    await next()
    await next()
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
    const { user, next, card, toIngredients } = renderBuilder()
    await user.click(card('Grande'))
    await next()
    await user.click(card('Mitades'))
    await toIngredients()
    await user.click(within(screen.getByRole('group', { name: 'Extras para toda la pizza' })).getByRole('checkbox', { name: 'Extra queso' }))
    expect(screen.getByRole('status', { name: 'Resumen de la pizza' })).toHaveTextContent('Pizza Grande · Mitad Varas / Mitad Varas · Extra queso')
  })
})

describe('PizzaBuilderModal styles', () => {
  it('lets Estilo Mexicana pick one or two chiles, starting on the 3 chiles', async () => {
    const catalog: PizzaCatalog = { ...pizzaCatalogFixture, styles: [...pizzaCatalogFixture.styles, MEXICANA] }
    const { onAdd, user, next, add, card, toIngredients } = renderBuilder(catalog)
    await next()
    await next()
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

  it('lists Pepperoni and Hawaiana first, then the rest A-Z, and starts on Pepperoni', async () => {
    const catalog: PizzaCatalog = {
      ...pizzaCatalogFixture,
      styles: [
        ...pizzaCatalogFixture.styles,
        { id: 'hawaiana', name: 'Estilo Hawaiana', description: '', kind: 'special', includedIngredients: 0, sortOrder: 3 },
        { id: 'pepperoni', name: 'Estilo Pepperoni', description: '', kind: 'special', includedIngredients: 0, sortOrder: 4 },
      ],
    }
    const { next } = renderBuilder(catalog)
    await next()
    await next()
    const cards = within(screen.getByRole('group', { name: 'Estilo de la Pizza entera' })).getAllByRole('button')
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining('Estilo Pepperoni'),
      expect.stringContaining('Estilo Hawaiana'),
      expect.stringContaining('Arma tu combinación'),
      expect.stringContaining('Estilo Varas'),
    ])
    expect(cards[0]).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows only the divisions allowed by the size and resets an invalid one when resizing', async () => {
    const { user, next, back, card } = renderBuilder()
    await next()
    const division = screen.getByRole('group', { name: 'División' })
    expect(within(division).queryByRole('button', { name: 'Cuartos' })).not.toBeInTheDocument()
    await back()
    await user.click(card('Grande'))
    await next()
    await user.click(card('Cuartos'))
    await next()
    expect(screen.getByRole('group', { name: 'Estilo de la Porción 1' })).toBeVisible()
    await back()
    await back()
    await user.click(card('Chica'))
    await next()
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
    const { onAdd, user, next, back, add, card } = renderBuilder()
    await user.click(card('Grande'))
    await next()
    await user.click(card('Mitades'))
    await next()
    await next()
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
    const { onAdd, user, next, back, add, card, toIngredients } = renderBuilder()
    await next()
    await next()
    await user.click(screen.getByRole('checkbox', { name: 'Extra queso' }))
    await back()
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
    expect(card(/Chica/)).toHaveAttribute('aria-pressed', 'true')
  })

  it('starts on the first available size when the first one is sold out', async () => {
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
    expect(screen.getByRole('button', { name: /^Siguiente/ })).toBeDisabled()
    expect(screen.getAllByText('Agotado')).toHaveLength(2)
  })
})
