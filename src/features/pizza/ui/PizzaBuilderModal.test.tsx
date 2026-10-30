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

function renderBuilder(catalog: PizzaCatalog = pizzaCatalogFixture) {
  const onAdd = vi.fn()
  render(<PizzaBuilderModal catalog={catalog} onAdd={onAdd} onClose={vi.fn()} />)
  return { onAdd, user: userEvent.setup() }
}

describe('PizzaBuilderModal', () => {
  it('adds a whole special pizza with its description and note', async () => {
    const { onAdd, user } = renderBuilder()
    expect(screen.getByText('Pizza Chica: Estilo Varas')).toBeVisible()
    await user.type(screen.getByLabelText(/nota de la pizza/i), 'bien cocida')
    await user.click(screen.getByRole('button', { name: 'Agregar pizza' }))
    expect(onAdd).toHaveBeenCalledWith({
      config: {
        size: 'chica',
        portions: [{ styleId: 'varas', ingredientIds: [], extraIngredientIds: [] }],
        extraIds: [],
      },
      name: 'Pizza Chica: Estilo Varas',
      notes: 'bien cocida',
    })
  })

  it('lists styles, ingredients and extras alphabetically, ignoring their sort order', () => {
    renderBuilder()
    const names = (elements: HTMLElement[]) => elements.map((element) => element.textContent)
    expect(names(screen.getAllByRole('option'))).toEqual(['Arma tu combinación', 'Estilo Varas'])
    const extraIngredients = screen.getByRole('group', { name: /ingredientes extra/i })
    expect(names(within(extraIngredients).getAllByRole('button'))).toEqual(['Jalapeños', 'Pepperoni', 'Piña'])
    const extras = screen.getByRole('group', { name: 'Extras' })
    expect(names(within(extras).getAllByRole('button')).map((name) => name?.replace(/\$.*/, '').trim())).toEqual([
      'Extra queso',
      'Orilla rellena',
    ])
  })

  it('lists Pepperoni and Hawaiana first and starts on Pepperoni', () => {
    const catalog: PizzaCatalog = {
      ...pizzaCatalogFixture,
      styles: [
        ...pizzaCatalogFixture.styles,
        { id: 'hawaiana', name: 'Estilo Hawaiana', description: '', kind: 'special', includedIngredients: 0, sortOrder: 3 },
        { id: 'pepperoni', name: 'Estilo Pepperoni', description: '', kind: 'special', includedIngredients: 0, sortOrder: 4 },
      ],
    }
    renderBuilder(catalog)
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Estilo Pepperoni',
      'Estilo Hawaiana',
      'Arma tu combinación',
      'Estilo Varas',
    ])
    expect(screen.getByLabelText('Estilo')).toHaveValue('pepperoni')
    expect(screen.getByText('Pizza Chica: Estilo Pepperoni')).toBeVisible()
  })

  it('shows only the divisions allowed by the size and resets an invalid one when resizing', async () => {
    const { user } = renderBuilder()
    const division = screen.getByRole('group', { name: 'División' })
    expect(within(division).queryByRole('button', { name: 'Cuartos' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Grande' }))
    await user.click(screen.getByRole('button', { name: 'Cuartos' }))
    expect(screen.getAllByRole('group', { name: /porción/i })).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: 'Chica' }))
    expect(screen.getByRole('group', { name: 'Pizza entera' })).toBeVisible()
  })

  it('requires at least one ingredient for the custom style and caps them at the limit', async () => {
    const { onAdd, user } = renderBuilder()
    await user.selectOptions(screen.getByLabelText('Estilo'), 'custom')
    const add = screen.getByRole('button', { name: 'Agregar pizza' })
    expect(add).toBeDisabled()
    expect(screen.getByText(/elige al menos un ingrediente/i)).toBeVisible()

    const included = screen.getByRole('group', { name: /^Ingredientes \(/ })
    await user.click(within(included).getByRole('button', { name: 'Pepperoni' }))
    expect(add).toBeEnabled()
    await user.click(within(included).getByRole('button', { name: 'Jalapeños' }))
    expect(screen.getByRole('group', { name: 'Ingredientes (2/2)' })).toBeVisible()
    expect(within(included).getByRole('button', { name: 'Piña' })).toBeDisabled()

    await user.click(add)
    expect(onAdd.mock.calls[0]?.[0].name).toBe('Pizza Chica: Arma tu combinación (Jalapeños, Pepperoni)')
  })

  it('doubles an included ingredient on the second tap as a charged extra, and removes it on the third', async () => {
    const { onAdd, user } = renderBuilder()
    await user.selectOptions(screen.getByLabelText('Estilo'), 'custom')
    const included = () => screen.getByRole('group', { name: /^Ingredientes \(/ })
    const extras = () => screen.getByRole('group', { name: /^Ingredientes extra/ })
    const chip = () => within(included()).getByRole('button', { name: /Jalapeños/ })

    await user.click(chip())
    expect(chip()).toHaveClass('bg-red-700')
    expect(within(chip()).queryByText('Extra')).not.toBeInTheDocument()
    expect(included()).toHaveAccessibleName('Ingredientes (1/2)')

    await user.click(chip())
    expect(chip()).toHaveAttribute('aria-pressed', 'true')
    expect(chip()).toHaveClass('bg-yellow-400', 'text-yellow-950', 'ring-2', 'ring-yellow-600')
    expect(within(chip()).getByText('Extra')).toBeVisible()
    expect(included()).toHaveAccessibleName('Ingredientes (1/2)')
    expect(extras()).toHaveAccessibleName('Ingredientes extra (1)')
    expect(screen.getByText('Pizza Chica: Arma tu combinación (Extra Jalapeños)')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Agregar pizza' }))
    expect(onAdd.mock.calls[0]?.[0].config.portions).toEqual([
      { styleId: 'custom', ingredientIds: ['jal'], extraIngredientIds: ['jal'] },
    ])
    expect(onAdd.mock.calls[0]?.[0].name).toBe('Pizza Chica: Arma tu combinación (Extra Jalapeños)')

    await user.click(chip())
    expect(chip()).toHaveAttribute('aria-pressed', 'false')
    expect(included()).toHaveAccessibleName('Ingredientes (0/2)')
    expect(extras()).toHaveAccessibleName('Ingredientes extra (0)')
  })

  it('lets a special style add its included ingredients without requiring them', async () => {
    const catalog: PizzaCatalog = {
      ...pizzaCatalogFixture,
      styles: pizzaCatalogFixture.styles.map((style) => ({ ...style, includedIngredients: 2 })),
    }
    const { onAdd, user } = renderBuilder(catalog)
    const add = screen.getByRole('button', { name: 'Agregar pizza' })
    expect(add).toBeEnabled()

    const included = screen.getByRole('group', { name: 'Ingredientes (0/2)' })
    await user.click(within(included).getByRole('button', { name: 'Pepperoni' }))
    await user.click(within(included).getByRole('button', { name: 'Jalapeños' }))
    expect(within(included).getByRole('button', { name: 'Piña' })).toBeDisabled()

    await user.click(add)
    expect(onAdd.mock.calls[0]?.[0].name).toBe('Pizza Chica: Estilo Varas (Jalapeños, Pepperoni)')
  })

  it('hides included ingredients on a style that includes none', () => {
    renderBuilder()
    expect(screen.queryByRole('group', { name: /^Ingredientes \(/ })).not.toBeInTheDocument()
  })

  it('configures extra ingredients per portion and extras once for the whole pizza', async () => {
    const { onAdd, user } = renderBuilder()
    await user.click(screen.getByRole('button', { name: 'Mitades' }))
    const second = screen.getByRole('group', { name: 'Mitad 2' })
    await user.click(within(second).getByRole('button', { name: 'Jalapeños' }))
    expect(within(second).queryByRole('group', { name: 'Extras' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Mitad 1' })).queryByRole('group', { name: 'Extras' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: 'Extras' })).toHaveLength(1)
    const extras = screen.getByRole('group', { name: 'Extras' })
    await user.click(within(extras).getByRole('button', { name: 'Orilla rellena' }))
    await user.click(within(extras).getByRole('button', { name: 'Extra queso' }))
    expect(within(extras).getByRole('button', { name: 'Extra queso' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(extras).getByRole('button', { name: 'Orilla rellena' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Agregar pizza' }))
    expect(onAdd.mock.calls[0]?.[0].config).toEqual({
      size: 'chica',
      portions: [
        { styleId: 'varas', ingredientIds: [], extraIngredientIds: [] },
        { styleId: 'varas', ingredientIds: [], extraIngredientIds: ['jal'] },
      ],
      extraIds: ['orilla', 'queso'],
    })
    expect(onAdd.mock.calls[0]?.[0].name).toBe(
      'Pizza Chica · Mitades: ½ Estilo Varas | ½ Estilo Varas + Jalapeños · Extras: Extra queso, Orilla rellena',
    )
  })

  it('doubles an extra ingredient on the second tap, marking it as Extra, and removes it on the third', async () => {
    const { onAdd, user } = renderBuilder()
    const extraIngredients = () => screen.getByRole('group', { name: /^Ingredientes extra/ })
    const chip = () => within(extraIngredients()).getByRole('button', { name: /Jalapeños/ })

    await user.click(chip())
    expect(chip()).toHaveAttribute('aria-pressed', 'true')
    expect(chip()).toHaveClass('bg-red-700')
    expect(within(chip()).queryByText('Extra')).not.toBeInTheDocument()
    expect(extraIngredients()).toHaveAccessibleName('Ingredientes extra (1)')

    await user.click(chip())
    expect(chip()).toHaveAttribute('aria-pressed', 'true')
    expect(chip()).toHaveClass('bg-yellow-400', 'text-yellow-950', 'ring-2', 'ring-yellow-600')
    expect(within(chip()).getByText('Extra')).toBeVisible()
    expect(extraIngredients()).toHaveAccessibleName('Ingredientes extra (2)')
    expect(screen.getByText('Pizza Chica: Estilo Varas + Extra Jalapeños')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Agregar pizza' }))
    expect(onAdd.mock.calls[0]?.[0].config.portions).toEqual([
      { styleId: 'varas', ingredientIds: [], extraIngredientIds: ['jal', 'jal'] },
    ])
    expect(onAdd.mock.calls[0]?.[0].name).toBe('Pizza Chica: Estilo Varas + Extra Jalapeños')

    await user.click(chip())
    expect(chip()).toHaveAttribute('aria-pressed', 'false')
    expect(within(chip()).queryByText('Extra')).not.toBeInTheDocument()
    expect(extraIngredients()).toHaveAccessibleName('Ingredientes extra (0)')
  })

  it('keeps the pizza extras when the division changes', async () => {
    const { onAdd, user } = renderBuilder()
    await user.click(within(screen.getByRole('group', { name: 'Extras' })).getByRole('button', { name: 'Extra queso' }))
    await user.click(screen.getByRole('button', { name: 'Mitades' }))
    await user.click(screen.getByRole('button', { name: 'Agregar pizza' }))
    expect(onAdd.mock.calls[0]?.[0].config.extraIds).toEqual(['queso'])
  })

  it('hides the extras group when there are no active extras', () => {
    renderBuilder({ ...pizzaCatalogFixture, extras: [] })
    expect(screen.queryByRole('group', { name: 'Extras' })).not.toBeInTheDocument()
  })

  describe('pizza dough', () => {
    it('shows a sold-out size as Agotado and cannot select it', async () => {
      const { user } = renderBuilder(withDough(null, 0))
      const grande = screen.getByRole('button', { name: /Grande/ })
      expect(within(grande).getByText('Agotado')).toBeVisible()
      expect(grande).toBeDisabled()
      await user.click(grande)
      expect(screen.getByText('Pizza Chica: Estilo Varas')).toBeVisible()
      expect(screen.getByRole('button', { name: /Chica/ })).toHaveAttribute('aria-pressed', 'true')
    })

    it('starts on the first available size when the first one is sold out', async () => {
      const { onAdd, user } = renderBuilder(withDough(0, 5))
      expect(screen.getByText('Pizza Grande: Estilo Varas')).toBeVisible()
      expect(screen.getByRole('button', { name: /Chica/ })).toBeDisabled()
      await user.click(screen.getByRole('button', { name: 'Agregar pizza' }))
      expect(onAdd.mock.calls[0]?.[0].config.size).toBe('grande')
    })

    it('shows how many doughs remain for a limited size and nothing for an unlimited one', () => {
      renderBuilder(withDough(3, null))
      expect(within(screen.getByRole('button', { name: /Chica/ })).getByText('Quedan 3')).toBeVisible()
      expect(screen.queryByText('Agotado')).not.toBeInTheDocument()
      expect(within(screen.getByRole('button', { name: /Grande/ })).queryByText(/Quedan/)).not.toBeInTheDocument()
    })

    it('blocks confirming when every size is sold out', () => {
      renderBuilder(withDough(0, 0))
      expect(screen.getByText('No hay masas de pizza disponibles.')).toBeVisible()
      expect(screen.getByRole('button', { name: 'Agregar pizza' })).toBeDisabled()
      expect(screen.getAllByText('Agotado')).toHaveLength(2)
    })
  })
})
