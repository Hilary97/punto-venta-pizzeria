import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listCategories, listProducts } from '../../products/infrastructure/productsRepository'
import { createSale } from '../infrastructure/salesRepository'
import { PosPage } from './PosPage'

vi.mock('../../products/infrastructure/productsRepository', () => ({ listCategories: vi.fn(), listProducts: vi.fn() }))
vi.mock('../infrastructure/salesRepository', () => ({ createSale: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(listCategories).mockResolvedValue([{ id: 'pizza', name: 'Pizzas', sortOrder: 0 }, { id: 'drink', name: 'Bebidas', sortOrder: 1 }])
  vi.mocked(listProducts).mockResolvedValue([
    { id: 'p', categoryId: 'pizza', name: 'Pizza queso', priceCents: 15000, active: true },
    { id: 'd', categoryId: 'drink', name: 'Agua', priceCents: 2000, active: true },
  ])
  vi.mocked(createSale).mockResolvedValue({ saleId: 'sale', totalCents: 16000, changeCents: 4000 })
})

async function setupSale() {
  const user = userEvent.setup()
  render(<PosPage />)
  await user.click(await screen.findByRole('button', { name: /pizza queso/i }))
  return { user, cash: screen.getByLabelText(/monto recibido/i), submit: screen.getByRole('button', { name: /registrar venta/i }) }
}

describe('integrated POS', () => {
  it('combines trimmed case-insensitive name search with category and keeps prices visible', async () => {
    const user = userEvent.setup()
    render(<PosPage />)
    await screen.findByRole('button', { name: /pizza queso/i })
    const search = screen.getByRole('searchbox', { name: /buscar producto/i })
    await user.type(search, '  PIZZA  ')
    expect(screen.getByRole('button', { name: /pizza queso.*150.00/i })).toBeVisible()
    expect(screen.queryByRole('button', { name: /agua/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Bebidas' }))
    expect(screen.getByText(/no hay productos que coincidan/i)).toBeVisible()
    await user.clear(search)
    expect(screen.getByRole('button', { name: /agua.*20.00/i })).toBeVisible()
  })

  it('shows an empty catalog and blocks checkout even with cash', async () => {
    vi.mocked(listProducts).mockResolvedValue([])
    const user = userEvent.setup()
    render(<PosPage />)
    expect(await screen.findByText(/no hay productos disponibles/i)).toBeVisible()
    await user.type(screen.getByLabelText(/monto recibido/i), '200')
    expect(screen.getByRole('button', { name: /registrar venta/i })).toBeDisabled()
  })

  it.each(['-1', 'abc', '1,85', '9'.repeat(400)])('rejects invalid cash %s', async (value) => {
    const { cash, submit } = await setupSale()
    fireEvent.change(cash, { target: { value } })
    expect(submit).toBeDisabled()
    expect(screen.getByText(/monto válido/i)).toBeVisible()
    expect(createSale).not.toHaveBeenCalled()
  })

  it('shows shortfall and change inline, sending multiple quantities without client prices', async () => {
    const { user, cash, submit } = await setupSale()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText(/monto recibido/i)).toHaveLength(1)
    await user.type(cash, '100')
    expect(submit).toBeDisabled()
    expect(screen.getByText(/faltan.*50.00/i)).toBeVisible()
    await user.click(screen.getByRole('button', { name: /agregar una unidad de pizza/i }))
    await user.click(screen.getByRole('button', { name: /agua/i }))
    await user.clear(cash)
    await user.type(cash, '400')
    expect(screen.getByText(/cambio:.*80.00/i)).toBeVisible()
    await user.click(submit)
    expect(createSale).toHaveBeenCalledWith([{ productId: 'p', quantity: 2 }, { productId: 'd', quantity: 1 }], 40000)
  })

  it('locks every sale mutation and guards immediate reentry, then resets using authoritative results', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof createSale>>) => void
    vi.mocked(createSale).mockReturnValue(new Promise((done) => { resolve = done }))
    const { user, cash, submit } = await setupSale()
    await user.type(cash, '200')
    const form = submit.closest('form')!
    act(() => { fireEvent.submit(form); fireEvent.submit(form) })
    expect(createSale).toHaveBeenCalledTimes(1)
    expect(cash).toBeDisabled()
    for (const name of [/pizza queso.*150.00/i, /agregar una unidad/i, /quitar una unidad/i, /eliminar pizza/i, /procesando/i]) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    await act(async () => resolve({ saleId: 's', totalCents: 16000, changeCents: 4000 }))
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Total cobrado: $160.00')
    expect(status).toHaveTextContent('Cambio: $40.00')
    expect(cash).toHaveValue('')
    expect(screen.getByText(/agrega productos/i)).toBeVisible()
    await user.click(screen.getByRole('button', { name: /agua/i }))
    expect(screen.queryByText(/venta registrada correctamente/i)).not.toBeInTheDocument()
    expect(submit).toBeDisabled()
  })

  it('opens the cart in a dialog from the mobile FAB and closes it after confirming a sale', async () => {
    const { user } = await setupSale()
    await user.click(screen.getByRole('button', { name: /ver carrito/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Pizza queso')).toBeVisible()
    await user.type(within(dialog).getByLabelText(/monto recibido/i), '200')
    await user.click(within(dialog).getByRole('button', { name: /registrar venta/i }))
    expect(createSale).toHaveBeenCalledWith([{ productId: 'p', quantity: 1 }], 20000)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('retains cash and cart on failure without retry, allowing correction', async () => {
    vi.mocked(createSale).mockRejectedValueOnce(new Error('No se pudo registrar la venta.'))
    const { user, cash, submit } = await setupSale()
    await user.type(cash, '200')
    await user.click(submit)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo registrar la venta.')
    expect(cash).toHaveValue('200')
    expect(within(screen.getByRole('list')).getByText('Pizza queso')).toBeVisible()
    expect(createSale).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: /quitar una unidad/i }))
    expect(submit).toBeDisabled()
    expect(cash).toHaveValue('200')
  })
})
