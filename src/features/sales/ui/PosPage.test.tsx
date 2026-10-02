import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Order } from '../../orders/domain/order'
import { getOrder, payOrder } from '../../orders/infrastructure/ordersRepository'
import { listCategories, listProducts } from '../../products/infrastructure/productsRepository'
import { createSale } from '../infrastructure/salesRepository'
import { PosPage } from './PosPage'

vi.mock('../../products/infrastructure/productsRepository', () => ({ listCategories: vi.fn(), listProducts: vi.fn() }))
vi.mock('../infrastructure/salesRepository', () => ({ createSale: vi.fn() }))
vi.mock('../../orders/infrastructure/ordersRepository', () => ({ getOrder: vi.fn(), payOrder: vi.fn() }))

function LocationProbe() {
  return <span data-testid="search">{useLocation().search}</span>
}

function renderPos(entry = '/') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <PosPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

const openOrder: Order = {
  id: 'o1',
  tableNumber: 3,
  customerName: 'Ana',
  status: 'open',
  createdAt: '2026-01-01T00:00:00Z',
  items: [
    { id: 'i1', productId: 'p', productName: 'Pizza queso', quantity: 2 },
    { id: 'i2', productId: 'd', productName: 'Agua', quantity: 1 },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(listCategories).mockResolvedValue([{ id: 'pizza', name: 'Pizzas', sortOrder: 0 }, { id: 'drink', name: 'Bebidas', sortOrder: 1 }])
  vi.mocked(listProducts).mockResolvedValue([
    { id: 'p', categoryId: 'pizza', name: 'Pizza queso', priceCents: 15000, active: true },
    { id: 'd', categoryId: 'drink', name: 'Agua', priceCents: 2000, active: true },
  ])
  vi.mocked(createSale).mockResolvedValue({ saleId: 'sale', totalCents: 16000, changeCents: 4000 })
  vi.mocked(getOrder).mockResolvedValue(openOrder)
  vi.mocked(payOrder).mockResolvedValue({ saleId: 'sale', totalCents: 32000, changeCents: 8000, orderId: 'o1' })
})

async function setupSale() {
  const user = userEvent.setup()
  renderPos()
  await user.click(await screen.findByRole('button', { name: /pizza queso/i }))
  return { user, cash: screen.getByLabelText(/monto recibido/i), submit: screen.getByRole('button', { name: /registrar venta/i }) }
}

describe('integrated POS', () => {
  it('combines trimmed case-insensitive name search with category and keeps prices visible', async () => {
    const user = userEvent.setup()
    renderPos()
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
    renderPos()
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

  it('does not load orders or show the order banner without the pedido param', async () => {
    renderPos()
    await screen.findByRole('button', { name: /pizza queso/i })
    expect(getOrder).not.toHaveBeenCalled()
    expect(screen.queryByText(/cobrando pedido/i)).not.toBeInTheDocument()
  })
})

describe('order checkout mode', () => {
  it('loads the order into a read-only cart priced with current products', async () => {
    const user = userEvent.setup()
    renderPos('/?pedido=o1')
    expect(await screen.findByText('Cobrando pedido M-3 · Ana')).toBeVisible()
    expect(getOrder).toHaveBeenCalledWith('o1')
    expect(within(screen.getByRole('list')).getByText('Pizza queso')).toBeVisible()
    expect(screen.getAllByText('$320.00').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /agregar una unidad/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /quitar una unidad/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /eliminar pizza/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /volver a pedidos/i })).toHaveAttribute('href', '/pedidos')
    await user.click(screen.getByRole('button', { name: /pizza queso.*150.00/i }))
    expect(screen.getByText('× 2')).toBeVisible()
    expect(screen.getAllByText('$320.00').length).toBeGreaterThan(0)
  })

  it('charges the order with payOrder instead of createSale and clears the param', async () => {
    const user = userEvent.setup()
    renderPos('/?pedido=o1')
    await screen.findByText('Cobrando pedido M-3 · Ana')
    await user.type(screen.getByLabelText(/monto recibido/i), '400')
    await user.click(screen.getByRole('button', { name: /registrar venta/i }))
    expect(payOrder).toHaveBeenCalledWith('o1', 40000)
    expect(createSale).not.toHaveBeenCalled()
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Pedido M-3 · Ana cobrado.')
    expect(status).toHaveTextContent('Total cobrado: $320.00')
    expect(status).toHaveTextContent('Cambio: $80.00')
    expect(screen.getByTestId('search')).toHaveTextContent('')
    expect(screen.queryByText(/cobrando pedido/i)).not.toBeInTheDocument()
    expect(screen.getByText(/agrega productos/i)).toBeVisible()
  })

  it('keeps the order and shows the error when payOrder rejects', async () => {
    vi.mocked(payOrder).mockRejectedValueOnce(new Error('No se pudo cobrar el pedido.'))
    const user = userEvent.setup()
    renderPos('/?pedido=o1')
    await screen.findByText('Cobrando pedido M-3 · Ana')
    await user.type(screen.getByLabelText(/monto recibido/i), '400')
    await user.click(screen.getByRole('button', { name: /registrar venta/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cobrar el pedido.')
    expect(screen.getByTestId('search')).toHaveTextContent('?pedido=o1')
    expect(screen.getByText('Cobrando pedido M-3 · Ana')).toBeVisible()
  })

  it('discards the order and returns to an empty normal POS', async () => {
    const user = userEvent.setup()
    renderPos('/?pedido=o1')
    await screen.findByText('Cobrando pedido M-3 · Ana')
    await user.click(screen.getByRole('button', { name: /descartar/i }))
    expect(await screen.findByText(/agrega productos/i)).toBeVisible()
    expect(screen.getByTestId('search')).toHaveTextContent('')
    expect(screen.queryByText(/cobrando pedido/i)).not.toBeInTheDocument()
  })

  it('blocks charging when an item product is inactive or missing', async () => {
    vi.mocked(getOrder).mockResolvedValue({
      ...openOrder,
      items: [...openOrder.items, { id: 'i3', productId: null, productName: 'Calzone', quantity: 1 }],
    })
    renderPos('/?pedido=o1')
    expect(await screen.findByRole('alert')).toHaveTextContent(/calzone/i)
    expect(screen.getByRole('link', { name: /volver a pedidos/i })).toHaveAttribute('href', '/pedidos')
    expect(screen.queryByRole('button', { name: /registrar venta/i })).not.toBeInTheDocument()
    expect(payOrder).not.toHaveBeenCalled()
  })

  it.each([
    ['not found', null],
    ['not open', { ...openOrder, status: 'paid' as const }],
  ])('blocks charging when the order is %s', async (_label, order) => {
    vi.mocked(getOrder).mockResolvedValue(order)
    renderPos('/?pedido=o1')
    expect(await screen.findByRole('alert')).toHaveTextContent(/pedido/i)
    expect(screen.getByRole('link', { name: /volver a pedidos/i })).toBeVisible()
    expect(screen.queryByRole('button', { name: /registrar venta/i })).not.toBeInTheDocument()
  })
})
