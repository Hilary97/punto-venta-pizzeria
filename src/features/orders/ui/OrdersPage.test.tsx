import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listPizzaCatalog } from '../../pizza/infrastructure/pizzaRepository'
import { listCategories, listProducts } from '../../products/infrastructure/productsRepository'
import type { Order } from '../domain/order'
import { addOrderItems, cancelOrder, createOrder, listOpenOrders, setOrderNotes } from '../infrastructure/ordersRepository'
import { pizzaCatalogFixture } from '../../pizza/ui/pizzaCatalogFixture'
import { subscribeKitchenChanges } from '../../kitchen/infrastructure/kitchenRepository'
import { OrdersPage } from './OrdersPage'

vi.mock('../../kitchen/infrastructure/kitchenRepository', () => ({ subscribeKitchenChanges: vi.fn() }))

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
  setOrderNotes: vi.fn(),
}))

const openOrder: Order = {
  id: 'order-1',
  token: 12,
  waiterName: null,
  notes: null,
  tableNumber: 3,
  customerName: 'Ana',
  status: 'open',
  createdAt: '2026-01-01T10:00:00Z',
  items: [{ id: 'i1', productId: 'p', productName: 'Pizza queso', quantity: 2, type: 'product' as const, pizza: null, notes: null, variant: null }],
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

/** Picks the service type of a new order. */
async function chooseService(user: ReturnType<typeof userEvent.setup>, label = 'Aquí') {
  await user.click(within(screen.getByRole('group', { name: 'Tipo de pedido' })).getByRole('button', { name: label }))
}

async function showCategory(user: ReturnType<typeof userEvent.setup>, name = 'Botanas') {
  await user.click(await screen.findByRole('button', { name }))
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(listPizzaCatalog).mockResolvedValue({ sizes: [], styles: [], ingredients: [], extras: [] })
  vi.mocked(listCategories).mockResolvedValue([{ id: 'pizza', name: 'Botanas', sortOrder: 0 }])
  vi.mocked(listProducts).mockResolvedValue([
    { id: 'p', categoryId: 'pizza', name: 'Pizza queso', priceCents: 15000, active: true, variants: [] },
  ])
  vi.mocked(listOpenOrders).mockResolvedValue([openOrder])
  vi.mocked(createOrder).mockResolvedValue('new-order')
  vi.mocked(addOrderItems).mockResolvedValue('order-1')
  vi.mocked(cancelOrder).mockResolvedValue('order-1')
  vi.mocked(setOrderNotes).mockResolvedValue('order-1')
  vi.mocked(subscribeKitchenChanges).mockReturnValue(() => {})
})

/** Simulates the realtime order-change signal and waits past its 300 ms merge window. */
async function signalOrdersChanged() {
  const onChange = vi.mocked(subscribeKitchenChanges).mock.calls.at(-1)![0]
  await act(async () => {
    onChange()
    await new Promise((resolve) => setTimeout(resolve, 350))
  })
}

describe('OrdersPage', () => {
  it('reloads the open orders, not the catalog, when the realtime signal arrives', async () => {
    const other: Order = { ...openOrder, id: 'order-2', tableNumber: 5, customerName: 'Beto', token: 13 }
    vi.mocked(listOpenOrders).mockResolvedValueOnce([openOrder]).mockResolvedValue([openOrder, other])
    renderPage()
    const region = await screen.findByRole('region', { name: /pedidos abiertos/i })
    expect(within(region).queryByText(/Beto/)).not.toBeInTheDocument()
    await signalOrdersChanged()
    expect(await within(region).findByText(/Beto/)).toBeVisible()
    expect(listOpenOrders).toHaveBeenCalledTimes(2)
    expect(listProducts).toHaveBeenCalledTimes(1)
  })

  it('renders the nine table buttons and hides product prices', async () => {
    const user = userEvent.setup()
    renderPage()
    await showCategory(user)
    const productButton = await screen.findByRole('button', { name: /pizza queso/i })
    const tables = screen.getByRole('group', { name: /mesa/i })
    for (let n = 1; n <= 9; n++) {
      expect(within(tables).getByRole('button', { name: `M-${n}` })).toHaveAttribute('aria-pressed', 'false')
    }
    expect(productButton).not.toHaveTextContent(/\$|150/)
    expect(screen.queryByText(/150\.00/)).not.toBeInTheDocument()
  })

  it('renders open orders under the all tab and products under a category', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('region', { name: /pedidos abiertos/i })).toBeVisible()
    expect(screen.queryByRole('button', { name: /pizza queso/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Botanas' }))
    expect(screen.getByRole('button', { name: /pizza queso/i })).toBeVisible()
    expect(screen.queryByRole('region', { name: /pedidos abiertos/i })).not.toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'Todos' })).not.toBeInTheDocument()
    const openOrdersButton = screen.getByRole('button', { name: 'Pedidos abiertos' })
    expect(screen.getByRole('group', { name: /categor/i })).not.toContainElement(openOrdersButton)
    await user.click(openOrdersButton)
    expect(screen.getByRole('region', { name: /pedidos abiertos/i })).toBeVisible()
  })

  it('scrolls to the open orders section when the bottom button is pressed', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    const user = userEvent.setup()
    renderPage()
    await showCategory(user)

    await user.click(screen.getByRole('button', { name: 'Pedidos abiertos' }))

    const section = screen.getByRole('region', { name: /pedidos abiertos/i })
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toContainElement(section)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    scrollIntoView.mockRestore()
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
    await showCategory(user)
    await user.click(screen.getByRole('button', { name: /pizza queso/i }))
    await user.click(screen.getByRole('button', { name: /agregar una unidad de pizza queso/i }))
    expect(submit).toBeDisabled()
    await chooseService(user)
    expect(submit).toBeEnabled()

    await user.click(submit)
    expect(createOrder).toHaveBeenCalledWith({
      tableNumber: 5,
      customerName: 'Luis Perez',
      items: [{ type: 'product', productId: 'p', quantity: 2 }],
      notes: null,
      scheduledFor: null,
      service: 'dine_in',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/pedido registrado/i)
    expect(screen.getByLabelText(/nombre del cliente/i)).toHaveValue('')
    expect(submit).toBeDisabled()
    expect(listOpenOrders).toHaveBeenCalledTimes(2)
  })

  it('requires choosing Aquí or Para llevar, sends it and resets it after registering', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'M-4' }))
    await showCategory(user)
    await user.click(screen.getByRole('button', { name: /pizza queso/i }))
    const submit = screen.getByRole('button', { name: /registrar pedido/i })
    const service = screen.getByRole('group', { name: 'Tipo de pedido' })
    expect(within(service).getByRole('button', { name: 'Aquí' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(service).getByRole('button', { name: 'Para llevar' })).toHaveAttribute('aria-pressed', 'false')
    expect(submit).toBeDisabled()

    await user.click(within(service).getByRole('button', { name: 'Para llevar' }))
    expect(within(service).getByRole('button', { name: 'Para llevar' })).toHaveAttribute('aria-pressed', 'true')
    expect(submit).toBeEnabled()
    await user.click(submit)

    expect(createOrder).toHaveBeenCalledWith({
      tableNumber: 4,
      customerName: null,
      items: [{ type: 'product', productId: 'p', quantity: 1 }],
      notes: null,
      scheduledFor: null,
      service: 'takeaway',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/pedido registrado/i)
    expect(within(service).getByRole('button', { name: 'Para llevar' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('does not offer the service type when adding products to an existing order', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /agregar productos/i }))
    expect(screen.queryByRole('group', { name: 'Tipo de pedido' })).not.toBeInTheDocument()
  })

  it('shows the service type of open orders, and none for orders without one', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([
      { ...openOrder, service: 'takeaway' },
      { ...openOrder, id: 'order-2', customerName: 'Beto', service: 'dine_in' },
      { ...openOrder, id: 'order-3', customerName: 'Ceci', service: null },
    ])
    renderPage()
    expect(within((await screen.findByText('Ana')).closest('li')!).getByText('Para llevar')).toBeVisible()
    expect(within(screen.getByText('Beto').closest('li')!).getByText('Aquí')).toBeVisible()
    const legacy = screen.getByText('Ceci').closest('li')!
    expect(within(legacy).queryByText('Aquí')).not.toBeInTheDocument()
    expect(within(legacy).queryByText('Para llevar')).not.toBeInTheDocument()
  })

  it('enables register with only a table', async () => {
    const user = userEvent.setup()
    renderPage()
    await showCategory(user)
    await user.click(await screen.findByRole('button', { name: /pizza queso/i }))
    const submit = screen.getByRole('button', { name: /registrar pedido/i })
    await chooseService(user)
    expect(submit).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'M-4' }))
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(createOrder).toHaveBeenCalledWith({
      tableNumber: 4,
      customerName: null,
      items: [{ type: 'product', productId: 'p', quantity: 1 }],
      notes: null,
      scheduledFor: null,
      service: 'dine_in',
    })
  })

  it('enables register with only a name', async () => {
    const user = userEvent.setup()
    renderPage()
    await showCategory(user)
    await user.click(await screen.findByRole('button', { name: /pizza queso/i }))
    const submit = screen.getByRole('button', { name: /registrar pedido/i })
    await chooseService(user)
    await user.type(screen.getByLabelText(/nombre del cliente/i), ' Juan ')
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(createOrder).toHaveBeenCalledWith({
      tableNumber: null,
      customerName: 'Juan',
      items: [{ type: 'product', productId: 'p', quantity: 1 }],
      notes: null,
      scheduledFor: null,
      service: 'dine_in',
    })
  })

  it('keeps register disabled with neither table nor a non-blank name', async () => {
    const user = userEvent.setup()
    renderPage()
    await showCategory(user)
    await user.click(await screen.findByRole('button', { name: /pizza queso/i }))
    await chooseService(user)
    await user.type(screen.getByLabelText(/nombre del cliente/i), '   ')
    expect(screen.getByRole('button', { name: /registrar pedido/i })).toBeDisabled()
  })

  it('deselects the table when tapping it again', async () => {
    const user = userEvent.setup()
    renderPage()
    await showCategory(user)
    await user.click(await screen.findByRole('button', { name: /pizza queso/i }))
    await chooseService(user)
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
    await showCategory(user)
    await user.click(screen.getByRole('button', { name: /pizza queso/i }))
    await chooseService(user)
    await user.click(screen.getByRole('button', { name: /registrar pedido/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo crear el pedido.')
    expect(screen.getByRole('button', { name: /registrar pedido/i })).toBeEnabled()
  })

  it('lists open orders with their items', async () => {
    renderPage()
    const card = (await screen.findByText('Ana')).closest('li')!
    expect(within(card).getByText('M-3')).toBeVisible()
    expect(within(card).getByText('Ficha 12')).toBeVisible()
    expect(within(card).getByText(/pizza queso × 2/i)).toBeVisible()
  })

  it('shows Entregado instead of a token when every line was delivered', async () => {
    const line = openOrder.items[0]!
    vi.mocked(listOpenOrders).mockResolvedValue([
      { ...openOrder, token: null, items: [{ ...line, deliveredAt: '2026-01-01T10:30:00Z' }] },
      { ...openOrder, id: 'order-2', customerName: 'Beto', token: null, items: [{ ...line, deliveredAt: null }] },
    ])
    renderPage()
    const delivered = (await screen.findByText('Ana')).closest('li')!
    expect(within(delivered).getByText('Entregado')).toBeVisible()
    expect(within(delivered).queryByText('Sin ficha')).not.toBeInTheDocument()

    const pending = screen.getByText('Beto').closest('li')!
    expect(within(pending).getByText('Sin ficha')).toBeVisible()
    expect(within(pending).queryByText('Entregado')).not.toBeInTheDocument()
  })


  describe('pickup time', () => {
    const at = (h: number, m: number) => new Date(2026, 9, 21, h, m)

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(at(12, 0))
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    async function fillOrder(user: ReturnType<typeof userEvent.setup>) {
      await user.click(await screen.findByRole('button', { name: 'M-4' }))
      await showCategory(user)
      await user.click(screen.getByRole('button', { name: /pizza queso/i }))
      await chooseService(user)
    }

    it('sends the pickup time for today and clears it after registering', async () => {
      const user = userEvent.setup()
      renderPage()
      await fillOrder(user)
      const time = screen.getByLabelText('Hora para recoger (opcional)')
      await user.type(time, '14:30')
      await user.click(screen.getByRole('button', { name: /registrar pedido/i }))

      expect(createOrder).toHaveBeenCalledWith({
        tableNumber: 4,
        customerName: null,
        items: [{ type: 'product', productId: 'p', quantity: 1 }],
        notes: null,
        scheduledFor: at(14, 30).toISOString(),
        service: 'dine_in',
      })
      expect(await screen.findByRole('status')).toHaveTextContent(/pedido registrado/i)
      expect(screen.getByLabelText('Hora para recoger (opcional)')).toHaveValue('')
    })

    it('rejects a time that is not later today and keeps the draft', async () => {
      const user = userEvent.setup()
      renderPage()
      await fillOrder(user)
      await user.type(screen.getByLabelText('Hora para recoger (opcional)'), '11:00')
      await user.click(screen.getByRole('button', { name: /registrar pedido/i }))

      expect(await screen.findByRole('alert')).toHaveTextContent('La hora del pedido debe ser más tarde hoy.')
      expect(createOrder).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Hora para recoger (opcional)')).toHaveValue('11:00')
    })

    it('is not offered when adding products to an existing order', async () => {
      const user = userEvent.setup()
      renderPage()
      await user.click(await screen.findByRole('button', { name: /agregar productos/i }))
      expect(screen.queryByLabelText('Hora para recoger (opcional)')).not.toBeInTheDocument()
    })

    it('shows scheduled orders with their time, waiting ones as Programado', async () => {
      vi.mocked(listOpenOrders).mockResolvedValue([
        { ...openOrder, token: null, scheduledFor: at(14, 30).toISOString(), queuedAt: null },
        { ...openOrder, id: 'order-2', customerName: 'Beto', token: 3, scheduledFor: at(13, 0).toISOString(), queuedAt: at(12, 40).toISOString() },
      ])
      renderPage()
      const waiting = (await screen.findByText('Ana')).closest('li')!
      expect(within(waiting).getByText('Programado')).toBeVisible()
      expect(within(waiting).getByText('Para las 2:30 p.m.')).toBeVisible()
      expect(within(waiting).queryByText('Sin ficha')).not.toBeInTheDocument()

      const queued = screen.getByText('Beto').closest('li')!
      expect(within(queued).getByText('Ficha 3')).toBeVisible()
      expect(within(queued).getByText('Para las 1:00 p.m.')).toBeVisible()
    })
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
    await showCategory(user)
    await user.click(screen.getByRole('button', { name: /pizza queso/i }))
    await user.click(screen.getByRole('button', { name: /agregar al pedido/i }))
    expect(addOrderItems).toHaveBeenCalledWith('order-1', [{ type: 'product', productId: 'p', quantity: 1 }])
    expect(createOrder).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent(/productos agregados/i)
    expect(screen.getByLabelText(/nombre del cliente/i)).toBeVisible()
  })

  it('scrolls to the pizza builder when starting to add items to an open order', async () => {
    vi.mocked(listPizzaCatalog).mockResolvedValue(pizzaCatalogFixture)
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /agregar productos/i }))

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toContainElement(screen.getByRole('button', { name: /armar pizza/i }))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    scrollIntoView.mockRestore()
  })

  it('shows a sticky add-mode bar naming the open order, with a cancel shortcut', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Ana')
    expect(screen.queryByRole('region', { name: /pedido en edición/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /agregar productos/i }))
    const bar = screen.getByRole('region', { name: /pedido en edición/i })
    expect(bar).toHaveTextContent('Agregando al pedido M-3 · Ana')
    expect(bar).toHaveTextContent('ya tiene 2 productos')
    expect(bar).toContainElement(screen.getByRole('button', { name: 'Cancelar' }))

    await user.click(within(bar).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('region', { name: /pedido en edición/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/nombre del cliente/i)).toBeVisible()
    expect(addOrderItems).not.toHaveBeenCalled()
  })

  it('labels the floating order button with the open order while adding', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /agregar productos/i }))
    expect(screen.getByRole('button', { name: 'Agregar a M-3 · Ana (0)' })).toBeInTheDocument()

    await showCategory(user)
    await user.click(screen.getByRole('button', { name: /pizza queso/i }))
    expect(screen.getByRole('button', { name: 'Agregar a M-3 · Ana (1)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ver pedido/i })).not.toBeInTheDocument()
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

  it('tells in the order dialog to choose Aquí or Para llevar until one is chosen', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'M-2' }))
    await showCategory(user)
    await user.click(screen.getByRole('button', { name: /pizza queso/i }))
    await user.click(screen.getByRole('button', { name: /ver pedido \(1\)/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Elige si es para aquí o para llevar.')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: /registrar pedido/i })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: /cerrar/i }))

    await chooseService(user)
    await user.click(screen.getByRole('button', { name: /ver pedido \(1\)/i }))
    expect(within(screen.getByRole('dialog')).queryByText('Elige si es para aquí o para llevar.')).not.toBeInTheDocument()
  })

  it('shows the order FAB with the item count and submits from the dialog', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Ana')
    expect(screen.queryByRole('button', { name: /ver pedido/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'M-2' }))
    await user.type(screen.getByLabelText(/nombre del cliente/i), 'Mara')
    await showCategory(user)
    await user.click(screen.getByRole('button', { name: /pizza queso/i }))
    await user.click(screen.getByRole('button', { name: /agregar una unidad de pizza queso/i }))
    await chooseService(user)
    await user.click(screen.getByRole('button', { name: /ver pedido \(2\)/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Pizza queso')).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: /registrar pedido/i }))
    expect(createOrder).toHaveBeenCalledWith({
      tableNumber: 2,
      customerName: 'Mara',
      items: [{ type: 'product', productId: 'p', quantity: 2 }],
      notes: null,
      scheduledFor: null,
      service: 'dine_in',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/pedido registrado/i)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ver pedido/i })).not.toBeInTheDocument()
  })

  it('keeps the FAB in add-items mode so the edit can be cancelled from the dialog', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /agregar productos/i }))
    await user.click(screen.getByRole('button', { name: /agregar a m-3 · ana \(0\)/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /cancelar edición/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/nombre del cliente/i)).toBeVisible()
  })


  it('creates orders without any waiter gate', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'M-4' }))
    await showCategory(user)
    await user.click(screen.getByRole('button', { name: /pizza queso/i }))
    await chooseService(user)
    await user.click(screen.getByRole('button', { name: /registrar pedido/i }))
    expect(createOrder).toHaveBeenCalledWith({
      tableNumber: 4,
      customerName: null,
      items: [{ type: 'product', productId: 'p', quantity: 1 }],
      notes: null,
      scheduledFor: null,
      service: 'dine_in',
    })
    expect(screen.queryByText(/^Mesero:/)).not.toBeInTheDocument()
  })


  it('shows who served each open order', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([{ ...openOrder, waiterName: 'Carlos' }])
    renderPage()
    const card = (await screen.findByText('Ana')).closest('li')!
    expect(within(card).getByText('Atendió: Carlos')).toBeVisible()
  })
})

describe('OrdersPage pizza builder and notes', () => {
  it('hides products of the legacy Pizzas category and its chip', async () => {
    vi.mocked(listCategories).mockResolvedValue([
      { id: 'pizza', name: ' pizzas ', sortOrder: 0 },
      { id: 'snacks', name: 'Botanas', sortOrder: 1 },
    ])
    vi.mocked(listProducts).mockResolvedValue([
      { id: 'p', categoryId: 'pizza', name: 'Pizza queso', priceCents: 0, active: true, variants: [] },
      { id: 'a', categoryId: 'snacks', name: 'Alitas', priceCents: 0, active: true, variants: [] },
    ])
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('button', { name: 'Botanas' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^pizzas$/i })).not.toBeInTheDocument()
    await showCategory(user)
    expect(await screen.findByRole('button', { name: /alitas/i })).toBeVisible()
    expect(screen.queryByRole('button', { name: /pizza queso/i })).not.toBeInTheDocument()
  })

  it('does not offer the builder when the pizza catalog has no sizes', async () => {
    renderPage()
    await screen.findByText('Ana')
    expect(screen.queryByRole('button', { name: /armar pizza/i })).not.toBeInTheDocument()
  })

  it('builds a pizza and sends it as a pizza line with its note', async () => {
    vi.mocked(listPizzaCatalog).mockResolvedValue(pizzaCatalogFixture)
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /armar pizza/i }))
    const builder = screen.getByRole('dialog', { name: /armar pizza/i })
    await user.click(within(builder).getByRole('button', { name: 'Agregar pizza' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    expect(screen.getByText('Pizza Chica: Estilo Varas')).toBeVisible()
    await user.type(screen.getByLabelText('Nota para Pizza Chica: Estilo Varas'), '  sin orilla ')
    await user.click(screen.getByRole('button', { name: 'M-6' }))
    await chooseService(user)
    await user.click(screen.getByRole('button', { name: /registrar pedido/i }))
    expect(createOrder).toHaveBeenCalledWith({
      tableNumber: 6,
      customerName: null,
      items: [
        {
          type: 'pizza',
          pizza: { size: 'chica', portions: [{ styleId: 'varas', ingredientIds: [], extraIngredientIds: [], extraIds: [] }] },
          quantity: 1,
          notes: 'sin orilla',
        },
      ],
      notes: null,
      scheduledFor: null,
      service: 'dine_in',
    })
  })

  it('keeps identical pizzas as separate lines', async () => {
    vi.mocked(listPizzaCatalog).mockResolvedValue(pizzaCatalogFixture)
    const user = userEvent.setup()
    renderPage()
    for (let i = 0; i < 2; i++) {
      await user.click(await screen.findByRole('button', { name: /armar pizza/i }))
      await user.click(screen.getByRole('button', { name: 'Agregar pizza' }))
    }
    expect(screen.getAllByText('Pizza Chica: Estilo Varas')).toHaveLength(2)
  })

  it('adds a built pizza to an existing order', async () => {
    vi.mocked(listPizzaCatalog).mockResolvedValue(pizzaCatalogFixture)
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /agregar productos/i }))
    await user.click(screen.getByRole('button', { name: /armar pizza/i }))
    await user.click(screen.getByRole('button', { name: 'Agregar pizza' }))
    await user.click(screen.getByRole('button', { name: /agregar al pedido/i }))
    expect(addOrderItems).toHaveBeenCalledWith('order-1', [expect.objectContaining({ type: 'pizza', quantity: 1 })])
  })

  it('sends a product line note and keeps noted lines separate from plain ones', async () => {
    const user = userEvent.setup()
    renderPage()
    await showCategory(user)
    await user.click(await screen.findByRole('button', { name: 'Pizza queso' }))
    await user.type(screen.getByLabelText('Nota para Pizza queso'), 'sin cebolla')
    await user.click(screen.getByRole('button', { name: 'Pizza queso' }))
    expect(screen.getAllByLabelText('Nota para Pizza queso')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'M-1' }))
    await chooseService(user)
    await user.click(screen.getByRole('button', { name: /registrar pedido/i }))
    expect(createOrder).toHaveBeenCalledWith({
      tableNumber: 1,
      customerName: null,
      items: [
        { type: 'product', productId: 'p', quantity: 1, notes: 'sin cebolla' },
        { type: 'product', productId: 'p', quantity: 1 },
      ],
      notes: null,
      scheduledFor: null,
      service: 'dine_in',
    })
  })

  it('sends the order note and clears it afterwards', async () => {
    const user = userEvent.setup()
    renderPage()
    await showCategory(user)
    await user.click(await screen.findByRole('button', { name: /pizza queso/i }))
    await user.type(screen.getByLabelText(/nota del pedido/i), '  cliente alérgico ')
    await user.click(screen.getByRole('button', { name: 'M-2' }))
    await chooseService(user)
    await user.click(screen.getByRole('button', { name: /registrar pedido/i }))
    expect(createOrder).toHaveBeenCalledWith({
      tableNumber: 2,
      customerName: null,
      items: [{ type: 'product', productId: 'p', quantity: 1 }],
      notes: 'cliente alérgico',
      scheduledFor: null,
      service: 'dine_in',
    })
    await screen.findByRole('status')
    expect(screen.getByLabelText(/nota del pedido/i)).toHaveValue('')
  })

  it('does not ask for an order note when adding to an existing order', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /agregar productos/i }))
    expect(screen.queryByLabelText(/nota del pedido/i)).not.toBeInTheDocument()
  })

  it('shows item and order notes on open orders', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([
      {
        ...openOrder,
        notes: 'Mesa con niños',
        items: [{ ...openOrder.items[0]!, notes: 'bien cocida' }],
      },
    ])
    renderPage()
    const card = (await screen.findByText('Ana')).closest('li')!
    expect(within(card).getByText('Nota: bien cocida')).toBeVisible()
    expect(within(card).getByText('Nota del pedido: Mesa con niños')).toBeVisible()
  })

  it('edits the note of an open order and refreshes the list', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([{ ...openOrder, notes: 'vieja' }])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /editar nota/i }))
    const dialog = screen.getByRole('dialog')
    const field = within(dialog).getByLabelText('Nota del pedido')
    expect(field).toHaveValue('vieja')
    await user.clear(field)
    await user.type(field, ' nueva ')
    await user.click(within(dialog).getByRole('button', { name: /guardar nota/i }))
    expect(setOrderNotes).toHaveBeenCalledWith('order-1', 'nueva')
    expect(await screen.findByRole('status')).toHaveTextContent(/nota actualizada/i)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(listOpenOrders).toHaveBeenCalledTimes(2)
  })

  it('clears the note when saved blank and shows an error when saving fails', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([{ ...openOrder, notes: 'vieja' }])
    vi.mocked(setOrderNotes).mockRejectedValueOnce(new Error('No se pudo guardar la nota.'))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /editar nota/i }))
    const dialog = screen.getByRole('dialog')
    await user.clear(within(dialog).getByLabelText('Nota del pedido'))
    await user.click(within(dialog).getByRole('button', { name: /guardar nota/i }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No se pudo guardar la nota.')
    await user.click(within(dialog).getByRole('button', { name: /guardar nota/i }))
    expect(setOrderNotes).toHaveBeenLastCalledWith('order-1', null)
    expect(setOrderNotes).toHaveBeenCalledTimes(2)
  })

  describe('products with variants', () => {
    beforeEach(() => {
      vi.mocked(listCategories).mockResolvedValue([{ id: 'burgers', name: 'Hamburguesas', sortOrder: 0 }])
      vi.mocked(listProducts).mockResolvedValue([
        { id: 'b', categoryId: 'burgers', name: 'Hamburguesa', priceCents: 9000, active: true, variants: ['Res', 'Pollo'] },
        { id: 'p', categoryId: 'burgers', name: 'Papas', priceCents: 4000, active: true, variants: [] },
      ])
    })

    async function openPicker(user: ReturnType<typeof userEvent.setup>) {
      if (!screen.queryByRole('button', { name: 'Hamburguesa' })) await showCategory(user, 'Hamburguesas')
      await user.click(await screen.findByRole('button', { name: 'Hamburguesa' }))
      return screen.getByRole('dialog', { name: 'Hamburguesa' })
    }

    it('opens the picker, adds the chosen variant and sends it in the payload', async () => {
      const user = userEvent.setup()
      renderPage()
      const picker = await openPicker(user)
      await user.click(within(picker).getByRole('button', { name: 'Pollo' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByText('Hamburguesa (Pollo)')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'M-2' }))
      await chooseService(user)
      await user.click(screen.getByRole('button', { name: /registrar pedido/i }))
      expect(createOrder).toHaveBeenCalledWith({
        tableNumber: 2,
        customerName: null,
        items: [{ type: 'product', productId: 'b', quantity: 1, variant: 'Pollo' }],
        notes: null,
        scheduledFor: null,
        service: 'dine_in',
      })
    })

    it('keeps different variants as separate lines', async () => {
      const user = userEvent.setup()
      renderPage()
      await user.click(within(await openPicker(user)).getByRole('button', { name: 'Res' }))
      await user.click(within(await openPicker(user)).getByRole('button', { name: 'Pollo' }))
      expect(screen.getByText('Hamburguesa (Res)')).toBeInTheDocument()
      expect(screen.getByText('Hamburguesa (Pollo)')).toBeInTheDocument()
    })

    it('merges the same variant into one line', async () => {
      const user = userEvent.setup()
      renderPage()
      await user.click(within(await openPicker(user)).getByRole('button', { name: 'Pollo' }))
      await user.click(within(await openPicker(user)).getByRole('button', { name: 'Pollo' }))
      expect(screen.getAllByText('Hamburguesa (Pollo)')).toHaveLength(1)
      await user.click(screen.getByRole('button', { name: 'M-1' }))
      await chooseService(user)
      await user.click(screen.getByRole('button', { name: /registrar pedido/i }))
      expect(createOrder).toHaveBeenCalledWith({
        tableNumber: 1,
        customerName: null,
        items: [{ type: 'product', productId: 'b', quantity: 2, variant: 'Pollo' }],
        notes: null,
        scheduledFor: null,
        service: 'dine_in',
      })
    })

    it('adds nothing when the picker is cancelled', async () => {
      const user = userEvent.setup()
      renderPage()
      const picker = await openPicker(user)
      await user.click(within(picker).getByRole('button', { name: /cancelar/i }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByText(/agrega productos al pedido/i)).toBeInTheDocument()
    })

    it('adds a product without variants directly', async () => {
      const user = userEvent.setup()
      renderPage()
      await showCategory(user, 'Hamburguesas')
      await user.click(await screen.findByRole('button', { name: 'Papas' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Quitar una unidad de Papas' })).toBeInTheDocument()
    })

    it('shows the variant on open orders', async () => {
      vi.mocked(listOpenOrders).mockResolvedValue([
        {
          ...openOrder,
          items: [{ id: 'i2', productId: 'b', productName: 'Hamburguesa', quantity: 2, type: 'product', pizza: null, notes: null, variant: 'Pollo' }],
        },
      ])
      renderPage()
      expect(await screen.findByText(/Hamburguesa \(Pollo\) × 2/)).toBeInTheDocument()
    })
  })
})

describe('stock in the product grid', () => {
  it('shows a sold-out product as Agotado and does not add it', async () => {
    const user = userEvent.setup()
    vi.mocked(listProducts).mockResolvedValue([
      { id: 'soda', categoryId: 'pizza', name: 'Refresco', priceCents: 2000, active: true, variants: [], trackStock: true, stock: 0, stockMin: 6 },
      { id: 'beer', categoryId: 'pizza', name: 'Cerveza', priceCents: 4000, active: true, variants: [], trackStock: true, stock: 2, stockMin: 6 },
    ])
    renderPage()
    await showCategory(user)
    const soda = screen.getByRole('button', { name: /Refresco/ })
    expect(soda).toBeDisabled()
    expect(within(soda).getByText('Agotado')).toBeVisible()
    const beer = screen.getByRole('button', { name: /Cerveza/ })
    expect(beer).toBeEnabled()
    expect(within(beer).queryByText('Agotado')).not.toBeInTheDocument()
    await user.click(soda)
    expect(soda).not.toHaveClass('border-emerald-600')
    await user.click(beer)
    expect(beer).toHaveClass('border-emerald-600')
  })

  it('gives a product in the order a dark background in dark mode so its name stays readable', async () => {
    const user = userEvent.setup()
    vi.mocked(listProducts).mockResolvedValue([
      { id: 'beer', categoryId: 'pizza', name: 'Cerveza', priceCents: 4000, active: true, variants: [], trackStock: false, stock: 0, stockMin: 0 },
    ])
    renderPage()
    await showCategory(user)
    const beer = screen.getByRole('button', { name: /Cerveza/ })
    expect(beer).not.toHaveClass('dark:bg-emerald-950/60')
    await user.click(beer)
    expect(beer).toHaveClass('bg-emerald-50', 'dark:bg-emerald-950/60')
  })
})

