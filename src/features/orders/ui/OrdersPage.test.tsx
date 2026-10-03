import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listPizzaCatalog } from '../../pizza/infrastructure/pizzaRepository'
import { listCategories, listProducts } from '../../products/infrastructure/productsRepository'
import type { Order } from '../domain/order'
import { addOrderItems, cancelOrder, createOrder, listOpenOrders } from '../infrastructure/ordersRepository'
import { OrdersPage } from './OrdersPage'

vi.mock('../../pizza/infrastructure/pizzaRepository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../pizza/infrastructure/pizzaRepository')>()),
  listPizzaCatalog: vi.fn(),
}))
vi.mock('../../products/infrastructure/productsRepository', () => ({ listCategories: vi.fn(), listProducts: vi.fn() }))
vi.mock('../infrastructure/ordersRepository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../infrastructure/ordersRepository')>()),
  listOpenOrders: vi.fn(),
  createOrder: vi.fn(),
  addOrderItems: vi.fn(),
  cancelOrder: vi.fn(),
}))

const openOrder: Order = {
  id: 'order-1',
  waiterName: null,
  notes: null,
  tableNumber: 3,
  customerName: 'Ana',
  status: 'open',
  createdAt: '2026-01-01T10:00:00Z',
  items: [{ id: 'i1', productId: 'p', productName: 'Pizza queso', quantity: 2, type: 'product' as const, pizza: null, notes: null }],
}

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/pedidos']}>
      <Routes>
        <Route path="/pedidos" element={<OrdersPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(listPizzaCatalog).mockResolvedValue({ sizes: [], styles: [], ingredients: [] })
  vi.mocked(listCategories).mockResolvedValue([{ id: 'pizza', name: 'Pizzas', sortOrder: 0 }])
  vi.mocked(listProducts).mockResolvedValue([
    { id: 'p', categoryId: 'pizza', name: 'Pizza queso', priceCents: 15000, active: true },
  ])
  vi.mocked(listOpenOrders).mockResolvedValue([openOrder])
  vi.mocked(createOrder).mockResolvedValue('new-order')
  vi.mocked(addOrderItems).mockResolvedValue('order-1')
  vi.mocked(cancelOrder).mockResolvedValue('order-1')
})

describe('OrdersPage', () => {
  it('renders the nine table buttons and hides product prices', async () => {
    renderPage()
    const productButton = await screen.findByRole('button', { name: /pizza queso/i })
    const tables = screen.getByRole('group', { name: /mesa/i })
    for (let n = 1; n <= 9; n++) {
      expect(within(tables).getByRole('button', { name: `M-${n}` })).toHaveAttribute('aria-pressed', 'false')
    }
    expect(productButton).not.toHaveTextContent(/\$|150/)
    expect(screen.queryByText(/150\.00/)).not.toBeInTheDocument()
  })

  it('keeps register disabled until a product and table or name are present, then sends the payload', async () => {
    const user = userEvent.setup()
    renderPage()
    const submit = await screen.findByRole('button', { name: /registrar pedido/i })
    expect(submit).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'M-5' }))
    expect(screen.getByRole('button', { name: 'M-5' })).toHaveAttribute('aria-pressed', 'true')
    expect(submit).toBeDisabled()
    await user.type(screen.getByLabelText(/nombre del cliente/i), '  Luis   Perez  ')
    expect(submit).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /pizza queso/i }))
    await user.click(screen.getByRole('button', { name: /agregar una unidad de pizza queso/i }))
    expect(submit).toBeEnabled()

    await user.click(submit)
    expect(createOrder).toHaveBeenCalledWith(5, 'Luis Perez', [{ type: 'product', productId: 'p', quantity: 2 }])
    expect(await screen.findByRole('status')).toHaveTextContent(/pedido registrado/i)
    expect(screen.getByLabelText(/nombre del cliente/i)).toHaveValue('')
    expect(submit).toBeDisabled()
    expect(listOpenOrders).toHaveBeenCalledTimes(2)
  })

  it('enables register with only a table', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /pizza queso/i }))
    const submit = screen.getByRole('button', { name: /registrar pedido/i })
    expect(submit).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'M-4' }))
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(createOrder).toHaveBeenCalledWith(4, null, [{ type: 'product', productId: 'p', quantity: 1 }])
  })

  it('enables register with only a name', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /pizza queso/i }))
    const submit = screen.getByRole('button', { name: /registrar pedido/i })
    await user.type(screen.getByLabelText(/nombre del cliente/i), ' Juan ')
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(createOrder).toHaveBeenCalledWith(null, 'Juan', [{ type: 'product', productId: 'p', quantity: 1 }])
  })

  it('keeps register disabled with neither table nor a non-blank name', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /pizza queso/i }))
    await user.type(screen.getByLabelText(/nombre del cliente/i), '   ')
    expect(screen.getByRole('button', { name: /registrar pedido/i })).toBeDisabled()
  })

  it('deselects the table when tapping it again', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /pizza queso/i }))
    await user.click(screen.getByRole('button', { name: 'M-5' }))
    expect(screen.getByRole('button', { name: /registrar pedido/i })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'M-5' }))
    expect(screen.getByRole('button', { name: 'M-5' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /registrar pedido/i })).toBeDisabled()
  })

  it('shows orders without a table only under Todas', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([
      openOrder,
      { ...openOrder, id: 'order-2', tableNumber: null, customerName: 'Beto' },
      { ...openOrder, id: 'order-3', tableNumber: 7, customerName: null },
    ])
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('Beto')).toBeVisible()
    const cardCount = () => screen.getAllByText(/pizza queso × 2/i).length
    expect(cardCount()).toBe(3)
    await user.selectOptions(screen.getByLabelText(/filtrar por mesa/i), '3')
    expect(screen.queryByText('Beto')).not.toBeInTheDocument()
    expect(cardCount()).toBe(1)
    expect(screen.getByText('Ana')).toBeVisible()
  })

  it('shows an error banner and keeps the draft when creation fails', async () => {
    vi.mocked(createOrder).mockRejectedValueOnce(new Error('No se pudo crear el pedido.'))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'M-1' }))
    await user.type(screen.getByLabelText(/nombre del cliente/i), 'Eva')
    await user.click(screen.getByRole('button', { name: /pizza queso/i }))
    await user.click(screen.getByRole('button', { name: /registrar pedido/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo crear el pedido.')
    expect(screen.getByRole('button', { name: /registrar pedido/i })).toBeEnabled()
  })

  it('lists open orders with their items', async () => {
    renderPage()
    const card = (await screen.findByText('Ana')).closest('li')!
    expect(within(card).getByText('M-3')).toBeVisible()
    expect(within(card).getByText(/pizza queso × 2/i)).toBeVisible()
  })


  it('shows Cobrar linking to the POS with the order id', async () => {
    const user = userEvent.setup()
    renderPage()
    const link = await screen.findByRole('link', { name: /cobrar/i })
    expect(link).toHaveAttribute('href', '/?pedido=order-1')
    await user.click(link)
    expect(screen.getByTestId('location')).toHaveTextContent('/?pedido=order-1')
  })

  it('adds items to an existing order and can leave that mode', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /agregar productos/i }))
    expect(screen.queryByLabelText(/nombre del cliente/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /mesa/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /pizza queso/i }))
    await user.click(screen.getByRole('button', { name: /agregar al pedido/i }))
    expect(addOrderItems).toHaveBeenCalledWith('order-1', [{ type: 'product', productId: 'p', quantity: 1 }])
    expect(createOrder).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent(/productos agregados/i)
    expect(screen.getByLabelText(/nombre del cliente/i)).toBeVisible()
  })

  it('cancels edit mode without calling the server', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /agregar productos/i }))
    await user.click(screen.getByRole('button', { name: /cancelar edición/i }))
    expect(screen.getByLabelText(/nombre del cliente/i)).toBeVisible()
    expect(addOrderItems).not.toHaveBeenCalled()
  })

  it('cancels an order only after confirming in the dialog', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /cancelar pedido/i }))
    const dialog = screen.getByRole('dialog')
    expect(cancelOrder).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: /sí, cancelar pedido/i }))
    expect(cancelOrder).toHaveBeenCalledWith('order-1')
    await screen.findByText(/pedido cancelado/i)
    expect(listOpenOrders).toHaveBeenCalledTimes(2)
  })

  it('reloads open orders with Actualizar', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Ana')
    await user.click(screen.getByRole('button', { name: /actualizar/i }))
    expect(listOpenOrders).toHaveBeenCalledTimes(2)
  })

  it('filters open orders by table', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([openOrder, { ...openOrder, id: 'order-2', tableNumber: 4, customerName: 'Beto' }])
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Beto')
    await user.selectOptions(screen.getByLabelText(/filtrar por mesa/i), '4')
    expect(screen.getByText('Beto')).toBeVisible()
    expect(screen.queryByText('Ana')).not.toBeInTheDocument()
  })

  it('shows the order FAB with the item count and submits from the dialog', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Ana')
    expect(screen.queryByRole('button', { name: /ver pedido/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'M-2' }))
    await user.type(screen.getByLabelText(/nombre del cliente/i), 'Mara')
    await user.click(screen.getByRole('button', { name: /pizza queso/i }))
    await user.click(screen.getByRole('button', { name: /agregar una unidad de pizza queso/i }))
    await user.click(screen.getByRole('button', { name: /ver pedido \(2\)/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Pizza queso')).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: /registrar pedido/i }))
    expect(createOrder).toHaveBeenCalledWith(2, 'Mara', [{ type: 'product', productId: 'p', quantity: 2 }])
    expect(await screen.findByRole('status')).toHaveTextContent(/pedido registrado/i)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ver pedido/i })).not.toBeInTheDocument()
  })

  it('keeps the FAB in add-items mode so the edit can be cancelled from the dialog', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /agregar productos/i }))
    await user.click(screen.getByRole('button', { name: /ver pedido \(0\)/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /cancelar edición/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/nombre del cliente/i)).toBeVisible()
  })


  it('creates orders without any waiter gate', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'M-4' }))
    await user.click(screen.getByRole('button', { name: /pizza queso/i }))
    await user.click(screen.getByRole('button', { name: /registrar pedido/i }))
    expect(createOrder).toHaveBeenCalledWith(4, null, [{ type: 'product', productId: 'p', quantity: 1 }])
    expect(screen.queryByText(/^Mesero:/)).not.toBeInTheDocument()
  })


  it('shows who served each open order', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([{ ...openOrder, waiterName: 'Carlos' }])
    renderPage()
    const card = (await screen.findByText('Ana')).closest('li')!
    expect(within(card).getByText('Atendió: Carlos')).toBeVisible()
  })
})
