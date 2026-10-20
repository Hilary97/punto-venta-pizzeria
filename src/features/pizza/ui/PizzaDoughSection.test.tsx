import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listPizzaDough, setPizzaDough } from '../infrastructure/pizzaDoughRepository'
import { PizzaDoughSection } from './PizzaDoughSection'

vi.mock('../infrastructure/pizzaDoughRepository', () => ({
  listPizzaDough: vi.fn(),
  setPizzaDough: vi.fn(),
}))

const loaded = {
  businessDay: '2026-10-20',
  sizes: [
    { sizeCode: 'grande' as const, name: 'Grande', prepared: 10, used: 4, left: 6 },
    { sizeCode: 'mediana' as const, name: 'Mediana', prepared: 0, used: 0, left: 0 },
    { sizeCode: 'chica' as const, name: 'Chica', prepared: null, used: null, left: null },
  ],
}

function rowOf(name: string) {
  return screen.getByRole('row', { name: new RegExp(name) })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(listPizzaDough).mockResolvedValue(loaded)
  vi.mocked(setPizzaDough).mockResolvedValue(undefined)
})

describe('PizzaDoughSection listing (S5)', () => {
  it('shows the heading with the business day without timezone shifting', async () => {
    render(<PizzaDoughSection />)
    expect(await screen.findByRole('heading', { name: 'Masas del día' })).toBeVisible()
    expect(screen.getByText('Día 20/10/2026')).toBeVisible()
  })

  it('shows prepared, made and left per size, and Sin límite for sizes without a row', async () => {
    render(<PizzaDoughSection />)
    await screen.findByRole('heading', { name: 'Masas del día' })
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Tamaño',
      'Preparadas',
      'Pizzas hechas',
      'Quedan',
      'Acciones',
    ])
    expect(within(rowOf('Grande')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Grande', '10', '4', '6', 'Cargar masas'])
    expect(within(rowOf('Mediana')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Mediana', '0', '0', '0', 'Cargar masas'])
    expect(within(rowOf('Chica')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Chica', 'Sin límite', '—', '—', 'Cargar masas'])
  })

  it('shows the error when loading fails', async () => {
    vi.mocked(listPizzaDough).mockRejectedValue(new Error('No se pudieron cargar las masas.'))
    render(<PizzaDoughSection />)
    expect(await screen.findByText('No se pudieron cargar las masas.')).toBeVisible()
  })
})

describe('PizzaDoughSection loading doughs (S3)', () => {
  it('prefills the prepared count, saves the new total, closes and reloads', async () => {
    const user = userEvent.setup()
    render(<PizzaDoughSection />)
    await screen.findByRole('heading', { name: 'Masas del día' })
    await user.click(within(rowOf('Grande')).getByRole('button', { name: 'Cargar masas' }))
    expect(screen.getByRole('dialog', { name: 'Masas de Grande' })).toBeVisible()
    const input = screen.getByLabelText('Masas preparadas')
    expect(input).toHaveValue('10')
    await user.clear(input)
    await user.type(input, '15')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(setPizzaDough).toHaveBeenCalledWith('grande', 15)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(listPizzaDough).toHaveBeenCalledTimes(2)
  })

  it('starts empty for a size without a row', async () => {
    const user = userEvent.setup()
    render(<PizzaDoughSection />)
    await screen.findByRole('heading', { name: 'Masas del día' })
    await user.click(within(rowOf('Chica')).getByRole('button', { name: 'Cargar masas' }))
    expect(screen.getByLabelText('Masas preparadas')).toHaveValue('')
  })

  it.each(['', '-1', '2.5', 'abc'])('rejects "%s" without calling the server', async (text) => {
    const user = userEvent.setup()
    render(<PizzaDoughSection />)
    await screen.findByRole('heading', { name: 'Masas del día' })
    await user.click(within(rowOf('Grande')).getByRole('button', { name: 'Cargar masas' }))
    const input = screen.getByLabelText('Masas preparadas')
    await user.clear(input)
    if (text) await user.type(input, text)
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(screen.getByText('La cantidad de masas no es válida.')).toBeVisible()
    expect(setPizzaDough).not.toHaveBeenCalled()
  })

  it('accepts zero', async () => {
    const user = userEvent.setup()
    render(<PizzaDoughSection />)
    await screen.findByRole('heading', { name: 'Masas del día' })
    await user.click(within(rowOf('Grande')).getByRole('button', { name: 'Cargar masas' }))
    const input = screen.getByLabelText('Masas preparadas')
    await user.clear(input)
    await user.type(input, '0')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(setPizzaDough).toHaveBeenCalledWith('grande', 0)
  })

  it('keeps the modal open and shows the server error', async () => {
    vi.mocked(setPizzaDough).mockRejectedValue(new Error('No puedes cargar menos masas de las que ya se usaron (4).'))
    const user = userEvent.setup()
    render(<PizzaDoughSection />)
    await screen.findByRole('heading', { name: 'Masas del día' })
    await user.click(within(rowOf('Grande')).getByRole('button', { name: 'Cargar masas' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('No puedes cargar menos masas de las que ya se usaron (4).')).toBeVisible()
    expect(screen.getByRole('dialog', { name: 'Masas de Grande' })).toBeVisible()
    expect(listPizzaDough).toHaveBeenCalledTimes(1)
  })
})
