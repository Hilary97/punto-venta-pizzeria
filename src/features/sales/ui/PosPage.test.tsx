import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Order } from '../../orders/domain/order'
import { getOrder, listOpenOrders, payOrder } from '../../orders/infrastructure/ordersRepository'
import { listProducts } from '../../products/infrastructure/productsRepository'
import { PosPage } from './PosPage'

vi.mock('../../products/infrastructure/productsRepository', () => ({ listProducts: vi.fn() }))
vi.mock('../../orders/infrastructure/ordersRepository', () => ({ getOrder: vi.fn(), listOpenOrders: vi.fn(), payOrder: vi.fn() }))

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
  waiterName: null,
  notes: null,
  tableNumber: 3,
  customerName: 'Ana',
  status: 'open',
  createdAt: '2026-01-01T00:00:00Z',
  items: [
    { id: 'i1', productId: 'p', productName: 'Pizza queso', quantity: 2, type: 'product' as const, pizza: null, notes: null },
    { id: 'i2', productId: 'd', productName: 'Agua', quantity: 1, type: 'product' as const, pizza: null, notes: null },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(listProducts).mockResolvedValue([
    { id: 'p', categoryId: 'pizza', name: 'Pizza queso', priceCents: 15000, active: true },
    { id: 'd', categoryId: 'drink', name: 'Agua', priceCents: 2000, active: true },
  ])
  vi.mocked(getOrder).mockResolvedValue(openOrder)
  vi.mocked(listOpenOrders).mockResolvedValue([])
  vi.mocked(payOrder).mockResolvedValue({ saleId: 'sale', totalCents: 32000, changeCents: 8000, orderId: 'o1' })
})

describe('Venta screen without direct sales', () => {
  it('shows only pending orders, without catalog, cart or checkout', async () => {
    renderPos()
    expect(await screen.findByText('Pedidos pendientes (0)')).toBeVisible()
    expect(screen.queryByRole('searchbox', { name: /buscar producto/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pizza queso/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bebidas' })).not.toBeInTheDocument()
    expect(screen.queryByText('Carrito')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/monto recibido/i)).not.toBeInTheDocument()
    expect(getOrder).not.toHaveBeenCalled()
    expect(screen.queryByText(/cobrando pedido/i)).not.toBeInTheDocument()
  })

  it('shows who served each pending order', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([{ ...openOrder, waiterName: 'Carlos' }])
    renderPos()
    expect(await screen.findByText('Atendió: Carlos')).toBeVisible()
  })

  it('shows an empty state with a link to Pedidos', async () => {
    renderPos()
    expect(await screen.findByText('Sin pedidos pendientes')).toBeVisible()
    expect(screen.getByText('Los pedidos se registran en Pedidos.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Ir a Pedidos' })).toHaveAttribute('href', '/pedidos')
  })
})

describe('order checkout mode', () => {
  it('appends the waiter to the checkout banner', async () => {
    vi.mocked(getOrder).mockResolvedValue({ ...openOrder, waiterName: 'Carlos' })
    renderPos('/?pedido=o1')
    expect(await screen.findByText('Cobrando pedido M-3 · Ana · Atendió Carlos')).toBeVisible()
  })

  it('loads the order into a read-only cart priced with current products', async () => {
    renderPos('/?pedido=o1')
    expect(await screen.findByText('Cobrando pedido M-3 · Ana')).toBeVisible()
    expect(getOrder).toHaveBeenCalledWith('o1')
    expect(within(screen.getByRole('list')).getByText('Pizza queso')).toBeVisible()
    expect(screen.getAllByText('$320.00').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /agregar una unidad/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /quitar una unidad/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /eliminar pizza/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /volver a pedidos/i })).toHaveAttribute('href', '/pedidos')
    expect(screen.getByText('× 2')).toBeVisible()
    expect(screen.queryByRole('searchbox', { name: /buscar producto/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pizza queso/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ver carrito/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText(/monto recibido/i)).toHaveLength(1)
  })

  it('charges the order with payOrder and clears the param', async () => {
    const user = userEvent.setup()
    renderPos('/?pedido=o1')
    await screen.findByText('Cobrando pedido M-3 · Ana')
    await user.type(screen.getByLabelText(/monto recibido/i), '400')
    await user.click(screen.getByRole('button', { name: /registrar venta/i }))
    expect(payOrder).toHaveBeenCalledWith('o1', 40000)
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Pedido M-3 · Ana cobrado.')
    expect(status).toHaveTextContent('Total cobrado: $320.00')
    expect(status).toHaveTextContent('Cambio: $80.00')
    expect(screen.getByTestId('search')).toHaveTextContent('')
    expect(screen.queryByText(/cobrando pedido/i)).not.toBeInTheDocument()
    expect(screen.getByText('Pedidos pendientes (0)')).toBeVisible()
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

  it('discards the order and returns to the pending orders list', async () => {
    const user = userEvent.setup()
    renderPos('/?pedido=o1')
    await screen.findByText('Cobrando pedido M-3 · Ana')
    await user.click(screen.getByRole('button', { name: /descartar/i }))
    expect(await screen.findByText('Pedidos pendientes (0)')).toBeVisible()
    expect(screen.getByTestId('search')).toHaveTextContent('')
    expect(screen.queryByText(/cobrando pedido/i)).not.toBeInTheDocument()
  })

  it('blocks charging when an item product is inactive or missing', async () => {
    vi.mocked(getOrder).mockResolvedValue({
      ...openOrder,
      items: [...openOrder.items, { id: 'i3', productId: null, productName: 'Calzone', quantity: 1, type: 'product' as const, pizza: null, notes: null }],
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

describe('pending orders panel', () => {
  const tableOnly: Order = { ...openOrder, id: 'o2', tableNumber: 5, customerName: null, items: openOrder.items.slice(0, 1) }
  const nameOnly: Order = { ...openOrder, id: 'o3', tableNumber: null, customerName: 'Juan', items: [] }

  it('lists open orders by table and/or name with item lines', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([openOrder, tableOnly, nameOnly])
    renderPos()
    expect(await screen.findByText('Pedidos pendientes (3)')).toBeVisible()
    expect(screen.getByText('M-3 · Ana')).toBeVisible()
    expect(screen.getByText('M-5', { selector: 'span' })).toBeVisible()
    expect(screen.getByText('Juan')).toBeVisible()
    expect(screen.getAllByRole('button', { name: /^cobrar/i })).toHaveLength(3)
    const card = screen.getByText('M-3 · Ana').closest('li')!
    expect(within(card).getByText('Pizza queso × 2')).toBeVisible()
    expect(within(card).getByText('Agua × 1')).toBeVisible()
  })

  it('enters order checkout when clicking Cobrar', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([openOrder, tableOnly])
    const user = userEvent.setup()
    renderPos()
    await screen.findByText('Pedidos pendientes (2)')
    await user.click(screen.getByRole('button', { name: /cobrar pedido m-3/i }))
    expect(await screen.findByText('Cobrando pedido M-3 · Ana')).toBeVisible()
    expect(screen.getByTestId('search')).toHaveTextContent('?pedido=o1')
  })

  it('is not shown or loaded in order mode', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([openOrder])
    renderPos('/?pedido=o1')
    await screen.findByText('Cobrando pedido M-3 · Ana')
    expect(screen.queryByText(/pedidos pendientes/i)).not.toBeInTheDocument()
    expect(listOpenOrders).not.toHaveBeenCalled()
  })

  it('reloads after a successful payOrder so the paid order disappears', async () => {
    vi.mocked(listOpenOrders).mockResolvedValueOnce([openOrder]).mockResolvedValue([])
    const user = userEvent.setup()
    renderPos()
    await screen.findByText('Pedidos pendientes (1)')
    await user.click(screen.getByRole('button', { name: /cobrar pedido m-3/i }))
    await screen.findByText('Cobrando pedido M-3 · Ana')
    await user.type(screen.getByLabelText(/monto recibido/i), '400')
    await user.click(screen.getByRole('button', { name: /registrar venta/i }))
    await screen.findByText(/cobrado\./i)
    expect(listOpenOrders).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('Pedidos pendientes (0)')).toBeVisible()
    expect(screen.queryByText('M-3 · Ana')).not.toBeInTheDocument()
  })

  it('reloads on Actualizar and shows load errors without breaking the screen', async () => {
    vi.mocked(listOpenOrders).mockRejectedValueOnce(new Error('No se pudieron cargar los pedidos.')).mockResolvedValue([nameOnly])
    const user = userEvent.setup()
    renderPos()
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar los pedidos.')
    await user.click(screen.getByRole('button', { name: /actualizar/i }))
    expect(await screen.findByText('Pedidos pendientes (1)')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('always offers Actualizar, even with zero orders, to fetch new ones', async () => {
    vi.mocked(listOpenOrders).mockResolvedValueOnce([]).mockResolvedValue([nameOnly])
    const user = userEvent.setup()
    renderPos()
    // The empty state only renders once loading finishes, which also enables Actualizar.
    expect(await screen.findByText('Sin pedidos pendientes')).toBeVisible()
    expect(screen.getByText('Pedidos pendientes (0)')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /actualizar/i }))
    expect(await screen.findByText('Pedidos pendientes (1)')).toBeVisible()
    expect(screen.getByText('Juan')).toBeVisible()
    expect(screen.queryByText('Sin pedidos pendientes')).not.toBeInTheDocument()
  })
})

describe('pending orders filters', () => {
  const jose: Order = { ...openOrder, id: 'f1', tableNumber: 3, customerName: 'José', items: [] }
  const juan: Order = { ...openOrder, id: 'f2', tableNumber: 5, customerName: 'Juan', items: [] }
  const ana: Order = { ...openOrder, id: 'f3', tableNumber: 3, customerName: 'Ana', items: [] }
  const noName: Order = { ...openOrder, id: 'f4', tableNumber: 7, customerName: null, items: [] }
  const all = [jose, juan, ana, noName]

  async function renderWithOrders() {
    vi.mocked(listOpenOrders).mockResolvedValue(all)
    const user = userEvent.setup()
    renderPos()
    await screen.findByText('Pedidos pendientes (4)')
    return user
  }

  it('hides the filter bar when there are no orders at all', async () => {
    renderPos()
    await screen.findByText('Sin pedidos pendientes')
    expect(screen.queryByRole('button', { name: 'Todas' })).not.toBeInTheDocument()
    expect(screen.queryByRole('searchbox', { name: 'Buscar por nombre' })).not.toBeInTheDocument()
  })

  it('filters cards by table and toggles back on a second click', async () => {
    const user = await renderWithOrders()
    expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'M-3' }))
    expect(screen.getByRole('button', { name: 'M-3' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('M-3 · José')).toBeVisible()
    expect(screen.getByText('M-3 · Ana')).toBeVisible()
    expect(screen.queryByText('M-5 · Juan')).not.toBeInTheDocument()
    expect(screen.getByText('Pedidos pendientes (2 de 4)')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'M-3' }))
    expect(screen.getByText('Pedidos pendientes (4)')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'M-5' }))
    await user.click(screen.getByRole('button', { name: 'Todas' }))
    expect(screen.getByText('Pedidos pendientes (4)')).toBeVisible()
  })

  it('filters by name ignoring case and accents', async () => {
    const user = await renderWithOrders()
    await user.type(screen.getByRole('searchbox', { name: 'Buscar por nombre' }), 'jose')
    expect(screen.getByText('M-3 · José')).toBeVisible()
    expect(screen.queryByText('M-3 · Ana')).not.toBeInTheDocument()
    expect(screen.queryByText('M-7', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.getByText('Pedidos pendientes (1 de 4)')).toBeVisible()
  })

  it('combines table and name filters and shows the filtered empty state', async () => {
    const user = await renderWithOrders()
    await user.click(screen.getByRole('button', { name: 'M-3' }))
    await user.type(screen.getByRole('searchbox', { name: 'Buscar por nombre' }), 'ana')
    expect(screen.getByText('M-3 · Ana')).toBeVisible()
    expect(screen.getByText('Pedidos pendientes (1 de 4)')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'M-5' }))
    expect(screen.getByText('No hay pedidos que coincidan.')).toBeVisible()
    expect(screen.queryByText('Sin pedidos pendientes')).not.toBeInTheDocument()
  })

  it('restores everything with Limpiar filtros', async () => {
    const user = await renderWithOrders()
    await user.click(screen.getByRole('button', { name: 'M-7' }))
    await user.type(screen.getByRole('searchbox', { name: 'Buscar por nombre' }), 'zzz')
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(screen.getByText('Pedidos pendientes (4)')).toBeVisible()
    expect(screen.getByRole('searchbox', { name: 'Buscar por nombre' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('button', { name: /^cobrar/i })).toHaveLength(4)
  })

  it('keeps filters after Actualizar', async () => {
    const user = await renderWithOrders()
    await user.click(screen.getByRole('button', { name: 'M-3' }))
    await user.click(screen.getByRole('button', { name: /actualizar/i }))
    await screen.findByText('Pedidos pendientes (2 de 4)')
    expect(screen.getByRole('button', { name: 'M-3' })).toHaveAttribute('aria-pressed', 'true')
  })
})
