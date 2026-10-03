import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { pizzaCatalogFixture } from './pizzaCatalogFixture'
import { PizzaBuilderModal } from './PizzaBuilderModal'

function renderBuilder() {
  const onAdd = vi.fn()
  render(<PizzaBuilderModal catalog={pizzaCatalogFixture} onAdd={onAdd} onClose={vi.fn()} />)
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
        portions: [{ styleId: 'varas', ingredientIds: [], extraIngredientIds: [], extraCheese: false }],
      },
      name: 'Pizza Chica: Estilo Varas',
      notes: 'bien cocida',
    })
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
    expect(onAdd.mock.calls[0]?.[0].name).toBe('Pizza Chica: Arma tu combinación (Pepperoni, Jalapeños)')
  })

  it('configures extras and extra cheese per portion', async () => {
    const { onAdd, user } = renderBuilder()
    await user.click(screen.getByRole('button', { name: 'Mitades' }))
    const second = screen.getByRole('group', { name: 'Mitad 2' })
    await user.click(within(second).getByRole('button', { name: 'Jalapeños' }))
    await user.click(within(second).getByRole('button', { name: 'Extra queso' }))
    expect(within(second).getByRole('button', { name: 'Extra queso' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Agregar pizza' }))
    expect(onAdd.mock.calls[0]?.[0].config.portions).toEqual([
      { styleId: 'varas', ingredientIds: [], extraIngredientIds: [], extraCheese: false },
      { styleId: 'varas', ingredientIds: [], extraIngredientIds: ['jal'], extraCheese: true },
    ])
  })
})
