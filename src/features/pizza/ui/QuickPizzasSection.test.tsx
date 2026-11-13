import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listPizzaCatalog } from '../infrastructure/pizzaRepository'
import {
  addQuickPizza,
  deleteQuickPizza,
  listQuickPizzas,
  moveQuickPizza,
} from '../infrastructure/quickPizzaRepository'
import { pizzaCatalogFixture } from './pizzaCatalogFixture'
import { QuickPizzasSection } from './QuickPizzasSection'

vi.mock('../infrastructure/pizzaRepository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../infrastructure/pizzaRepository')>()),
  listPizzaCatalog: vi.fn(),
}))
vi.mock('../infrastructure/quickPizzaRepository', () => ({
  listQuickPizzas: vi.fn(),
  addQuickPizza: vi.fn(),
  deleteQuickPizza: vi.fn(),
  moveQuickPizza: vi.fn(),
}))

const varasChica = { size: 'chica' as const, portions: [{ styleId: 'varas', ingredientIds: [], extraIngredientIds: [] }], extraIds: [] }
const varasGrande = { ...varasChica, size: 'grande' as const }
const gone = { ...varasChica, portions: [{ styleId: 'gone', ingredientIds: [], extraIngredientIds: [] }] }

function rows() {
  return within(screen.getByRole('list', { name: 'Pizzas rápidas' })).getAllByRole('listitem')
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(listPizzaCatalog).mockResolvedValue(pizzaCatalogFixture)
  vi.mocked(listQuickPizzas).mockResolvedValue([
    { id: 'a', pizza: varasGrande, available: true },
    { id: 'b', pizza: gone, available: false },
    { id: 'c', pizza: varasChica, available: true },
  ])
  vi.mocked(addQuickPizza).mockResolvedValue(undefined)
  vi.mocked(deleteQuickPizza).mockResolvedValue(undefined)
  vi.mocked(moveQuickPizza).mockResolvedValue(undefined)
})

describe('QuickPizzasSection', () => {
  it('lists the fixed pizzas in order and marks the unavailable ones', async () => {
    render(<QuickPizzasSection />)
    expect(await screen.findByRole('heading', { name: 'Pizzas rápidas' })).toBeVisible()
    expect(
      screen.getByText('El mesero las ve primero en "Más vendidas"; los lugares que sobren se completan con las más vendidas del mes.'),
    ).toBeVisible()
    await screen.findByRole('list', { name: 'Pizzas rápidas' })
    expect(rows().map((row) => within(row).getByTestId('quick-pizza-name').textContent)).toEqual([
      'Pizza Grande: Estilo Varas',
      'No disponible',
      'Pizza Chica: Estilo Varas',
    ])
    expect(within(rows()[1]!).getByText('Ya no se ofrece: cambió el catálogo.')).toBeVisible()
  })

  it('moves, removes and reloads', async () => {
    const user = userEvent.setup()
    render(<QuickPizzasSection />)
    await screen.findByRole('list', { name: 'Pizzas rápidas' })
    expect(within(rows()[0]!).getByRole('button', { name: 'Subir' })).toBeDisabled()
    expect(within(rows()[2]!).getByRole('button', { name: 'Bajar' })).toBeDisabled()

    await user.click(within(rows()[2]!).getByRole('button', { name: 'Subir' }))
    expect(moveQuickPizza).toHaveBeenCalledWith('c', -1)
    await user.click(within(rows()[0]!).getByRole('button', { name: 'Bajar' }))
    expect(moveQuickPizza).toHaveBeenLastCalledWith('a', 1)
    await user.click(within(rows()[1]!).getByRole('button', { name: 'Quitar' }))
    expect(deleteQuickPizza).toHaveBeenCalledWith('b')
    expect(listQuickPizzas).toHaveBeenCalledTimes(4)
  })

  it('fixes a pizza built with the builder, without quantity or note, even with no dough today', async () => {
    vi.mocked(listPizzaCatalog).mockResolvedValue({
      ...pizzaCatalogFixture,
      sizes: pizzaCatalogFixture.sizes.map((size) => ({ ...size, doughLeft: 0 })),
    })
    const user = userEvent.setup()
    render(<QuickPizzasSection />)
    await user.click(await screen.findByRole('button', { name: 'Agregar pizza rápida' }))
    const dialog = screen.getByRole('dialog', { name: /armar pizza/i })
    for (let i = 0; i < 6 && !within(dialog).queryByRole('button', { name: 'Fijar pizza' }); i++) {
      const card = within(dialog).queryByRole('button', { name: /Estilo Varas/ })
      if (card && card.getAttribute('aria-pressed') !== 'true') await user.click(card)
      await user.click(within(dialog).getByRole('button', { name: /^Siguiente/ }))
    }
    const card = within(dialog).queryByRole('button', { name: /Estilo Varas/ })
    if (card && card.getAttribute('aria-pressed') !== 'true') await user.click(card)
    expect(within(dialog).queryByRole('group', { name: 'Cantidad de pizzas' })).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Nota de la pizza (opcional)')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Fijar pizza' }))

    expect(addQuickPizza).toHaveBeenCalledTimes(1)
    expect(addQuickPizza).toHaveBeenCalledWith(varasChica)
    expect(screen.queryByRole('dialog', { name: /armar pizza/i })).not.toBeInTheDocument()
    expect(listQuickPizzas).toHaveBeenCalledTimes(2)
  })

  it('shows the server message when fixing fails', async () => {
    vi.mocked(addQuickPizza).mockRejectedValue(new Error('Esa pizza ya está en la lista.'))
    const user = userEvent.setup()
    render(<QuickPizzasSection />)
    await user.click(await screen.findByRole('button', { name: 'Agregar pizza rápida' }))
    const dialog = screen.getByRole('dialog', { name: /armar pizza/i })
    for (let i = 0; i < 6 && !within(dialog).queryByRole('button', { name: 'Fijar pizza' }); i++) {
      const card = within(dialog).queryByRole('button', { name: /Estilo Varas/ })
      if (card && card.getAttribute('aria-pressed') !== 'true') await user.click(card)
      await user.click(within(dialog).getByRole('button', { name: /^Siguiente/ }))
    }
    const card = within(dialog).queryByRole('button', { name: /Estilo Varas/ })
    if (card && card.getAttribute('aria-pressed') !== 'true') await user.click(card)
    await user.click(within(dialog).getByRole('button', { name: 'Fijar pizza' }))
    expect(await screen.findByText('Esa pizza ya está en la lista.')).toBeVisible()
  })

  it('hides the add button when 8 pizzas are fixed', async () => {
    vi.mocked(listQuickPizzas).mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, pizza: varasChica, available: true })),
    )
    render(<QuickPizzasSection />)
    expect(await screen.findByText('Llegaste al máximo de 8 pizzas rápidas.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Agregar pizza rápida' })).not.toBeInTheDocument()
  })

  it('shows the error when loading fails', async () => {
    vi.mocked(listQuickPizzas).mockRejectedValue(new Error('No se pudieron cargar las pizzas rápidas.'))
    render(<QuickPizzasSection />)
    expect(await screen.findByText('No se pudieron cargar las pizzas rápidas.')).toBeVisible()
  })
})
