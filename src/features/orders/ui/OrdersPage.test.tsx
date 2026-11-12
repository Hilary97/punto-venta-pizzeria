import { act, fireEvent, render, screen, within } from '@testing-library/react'
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

async function openOrdersSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^pedidos abiertos/i }))
  return screen.getByRole('dialog', { name: 'Pedidos abiertos' })
}

describe('open orders', () => {
  it('reloads the open orders, not the catalog, when the realtime signal arrives', async () => {
    const other: Order = { ...openOrder, id: 'order-2', tableNumber: 5, customerName: 'Beto', token: 13 }
    vi.mocked(listOpenOrders).mockResolvedValueOnce([openOrder]).mockResolvedValue([openOrder, other])
    const user = userEvent.setup()
    renderPage()
    const dialog = await openOrdersSheet(user)
    const region = within(dialog).getByRole('region', { name: /pedidos abiertos/i })
    expect(within(region).queryByText(/Beto/)).not.toBeInTheDocument()
    await signalOrdersChanged()
    expect(await within(region).findByText(/Beto/)).toBeVisible()
    expect(listOpenOrders).toHaveBeenCalledTimes(2)
    expect(listProducts).toHaveBeenCalledTimes(1)
  })

  it('shows the service type of open orders, and none for orders without one', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([
      { ...openOrder, service: 'takeaway' },
      { ...openOrder, id: 'order-2', customerName: 'Beto', service: 'dine_in' },
      { ...openOrder, id: 'order-3', customerName: 'Ceci', service: null },
    ])
    const user = userEvent.setup()
    renderPage()
    await openOrdersSheet(user)
    expect(within(screen.getByText('Ana').closest('li')!).getByText('Para llevar')).toBeVisible()
    expect(within(screen.getByText('Beto').closest('li')!).getByText('Aquí')).toBeVisible()
    const legacy = screen.getByText('Ceci').closest('li')!
    expect(within(legacy).queryByText('Aquí')).not.toBeInTheDocument()
    expect(within(legacy).queryByText('Para llevar')).not.toBeInTheDocument()
  })

  it('shows orders without a table only under Todas', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([
      openOrder,
      { ...openOrder, id: 'order-2', tableNumber: null, customerName: 'Beto' },
      { ...openOrder, id: 'order-3', tableNumber: 7, customerName: null },
    ])
    const user = userEvent.setup()
    renderPage()
    await openOrdersSheet(user)
    const cardCount = () => screen.getAllByText(/pizza queso × 2/i).length
    expect(cardCount()).toBe(3)
    await user.selectOptions(screen.getByLabelText(/filtrar por mesa/i), '3')
    expect(screen.queryByText('Beto')).not.toBeInTheDocument()
    expect(cardCount()).toBe(1)
    expect(screen.getByText('Ana')).toBeVisible()
  })

  it('searches open orders by customer name, ignoring case and accents, combined with the table filter', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([
      { ...openOrder, customerName: 'José' },
      { ...openOrder, id: 'order-2', tableNumber: 5, customerName: 'Josefina' },
      { ...openOrder, id: 'order-3', tableNumber: 3, customerName: 'Beto' },
      { ...openOrder, id: 'order-4', tableNumber: 7, customerName: null },
    ])
    const user = userEvent.setup()
    renderPage()
    await openOrdersSheet(user)
    const cardCount = () => screen.queryAllByText(/pizza queso × 2/i).length
    const search = screen.getByRole('searchbox', { name: /buscar por nombre/i })

    await user.type(search, 'JOSE')
    expect(cardCount()).toBe(2)
    expect(screen.getByText('José')).toBeVisible()
    expect(screen.getByText('Josefina')).toBeVisible()
    expect(screen.queryByText('Beto')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/filtrar por mesa/i), '3')
    expect(cardCount()).toBe(1)
    expect(screen.getByText('José')).toBeVisible()

    await user.clear(search)
    await user.type(search, 'zzz')
    expect(cardCount()).toBe(0)
    expect(screen.getByText('No hay pedidos que coincidan.')).toBeVisible()

    await user.clear(search)
    expect(cardCount()).toBe(2)
  })

  it('lists open orders with their items, who served them and their notes', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([
      { ...openOrder, waiterName: 'Carlos', notes: 'Mesa con niños', items: [{ ...openOrder.items[0]!, notes: 'bien cocida' }] },
    ])
    const user = userEvent.setup()
    renderPage()
    await openOrdersSheet(user)
    const card = screen.getByText('Ana').closest('li')!
    expect(within(card).getByText('M-3')).toBeVisible()
    expect(within(card).getByText('Ficha 12')).toBeVisible()
    expect(within(card).getByText(/pizza queso × 2/i)).toBeVisible()
    expect(within(card).getByText('Atendió: Carlos')).toBeVisible()
    expect(within(card).getByText('Nota: bien cocida')).toBeVisible()
    expect(within(card).getByText('Nota del pedido: Mesa con niños')).toBeVisible()
  })

  it('shows each portion of a built pizza and its ingredients on their own rows, without "|", "+" or "()"', async () => {
    const pizzaLine = {
      ...openOrder.items[0]!,
      id: 'i2',
      productId: null,
      productName: "Pizza Grande · Mitades: ½ Estilo Varas (Jamón, Piña) + Jalapeños | ½ Estilo Chuy's · Extras: Extra queso",
      quantity: 1,
      type: 'pizza' as const,
    }
    vi.mocked(listOpenOrders).mockResolvedValue([{ ...openOrder, items: [pizzaLine] }])
    const user = userEvent.setup()
    renderPage()
    await openOrdersSheet(user)
    const line = screen.getByText(/Pizza Grande · Mitades × 1/).closest('li')!
    for (const row of ['½ Estilo Varas', 'Jamón', 'Piña', 'Jalapeños', "½ Estilo Chuy's", 'Extras', 'Extra queso']) {
      expect(within(line).getByText(row)).toBeVisible()
    }
    expect(line.textContent).not.toMatch(/[|+()]/)
  })

  it('shows Entregado instead of a token when every line was delivered', async () => {
    const line = openOrder.items[0]!
    vi.mocked(listOpenOrders).mockResolvedValue([
      { ...openOrder, token: null, items: [{ ...line, deliveredAt: '2026-01-01T10:30:00Z' }] },
      { ...openOrder, id: 'order-2', customerName: 'Beto', token: null, items: [{ ...line, deliveredAt: null }] },
    ])
    const user = userEvent.setup()
    renderPage()
    await openOrdersSheet(user)
    const delivered = screen.getByText('Ana').closest('li')!
    expect(within(delivered).getByText('Entregado')).toBeVisible()
    expect(within(delivered).queryByText('Sin ficha')).not.toBeInTheDocument()
    const pending = screen.getByText('Beto').closest('li')!
    expect(within(pending).getByText('Sin ficha')).toBeVisible()
    expect(within(pending).queryByText('Entregado')).not.toBeInTheDocument()
  })

  it('shows scheduled orders with their time, waiting ones as Programado', async () => {
    const at = (h: number, m: number) => new Date(2026, 9, 21, h, m)
    vi.mocked(listOpenOrders).mockResolvedValue([
      { ...openOrder, token: null, scheduledFor: at(14, 30).toISOString(), queuedAt: null },
      { ...openOrder, id: 'order-2', customerName: 'Beto', token: 3, scheduledFor: at(13, 0).toISOString(), queuedAt: at(12, 40).toISOString() },
    ])
    const user = userEvent.setup()
    renderPage()
    await openOrdersSheet(user)
    const waiting = screen.getByText('Ana').closest('li')!
    expect(within(waiting).getByText('Programado')).toBeVisible()
    expect(within(waiting).getByText('Para las 2:30 p.m.')).toBeVisible()
    expect(within(waiting).queryByText('Sin ficha')).not.toBeInTheDocument()
    const queued = screen.getByText('Beto').closest('li')!
    expect(within(queued).getByText('Ficha 3')).toBeVisible()
    expect(within(queued).getByText('Para las 1:00 p.m.')).toBeVisible()
  })

  it('shows the variant on open orders', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([
      {
        ...openOrder,
        items: [{ id: 'i2', productId: 'b', productName: 'Hamburguesa', quantity: 2, type: 'product', pizza: null, notes: null, variant: 'Pollo' }],
      },
    ])
    const user = userEvent.setup()
    renderPage()
    await openOrdersSheet(user)
    expect(screen.getByText(/Hamburguesa \(Pollo\) × 2/)).toBeInTheDocument()
  })

  it('shows Cobrar linking to the POS with the order id', async () => {
    const user = userEvent.setup()
    renderPage()
    await openOrdersSheet(user)
    const link = screen.getByRole('link', { name: /cobrar/i })
    expect(link).toHaveAttribute('href', '/?pedido=order-1')
    await user.click(link)
    expect(screen.getByTestId('location')).toHaveTextContent('/?pedido=order-1')
  })

  it('cancels an order only after confirming in the dialog and refreshes the list', async () => {
    const user = userEvent.setup()
    renderPage()
    await openOrdersSheet(user)
    await user.click(screen.getByRole('button', { name: /cancelar pedido/i }))
    const dialog = screen.getByRole('dialog', { name: 'Cancelar pedido' })
    expect(cancelOrder).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: /sí, cancelar pedido/i }))
    expect(cancelOrder).toHaveBeenCalledWith('order-1')
    await screen.findByText(/pedido cancelado/i)
    expect(listOpenOrders).toHaveBeenCalledTimes(2)
  })

  it('reloads open orders with Actualizar', async () => {
    const user = userEvent.setup()
    renderPage()
    await openOrdersSheet(user)
    await user.click(screen.getByRole('button', { name: /actualizar/i }))
    expect(listOpenOrders).toHaveBeenCalledTimes(2)
  })

  it('edits the note of an open order and refreshes the list', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([{ ...openOrder, notes: 'vieja' }])
    const user = userEvent.setup()
    renderPage()
    await openOrdersSheet(user)
    await user.click(screen.getByRole('button', { name: /editar nota/i }))
    const dialog = screen.getByRole('dialog', { name: /nota del pedido/i })
    const field = within(dialog).getByLabelText('Nota del pedido')
    expect(field).toHaveValue('vieja')
    await user.clear(field)
    await user.type(field, ' nueva ')
    await user.click(within(dialog).getByRole('button', { name: /guardar nota/i }))
    expect(setOrderNotes).toHaveBeenCalledWith('order-1', 'nueva')
    expect(await screen.findByRole('status')).toHaveTextContent(/nota actualizada/i)
    expect(screen.queryByRole('dialog', { name: /nota del pedido/i })).not.toBeInTheDocument()
    expect(listOpenOrders).toHaveBeenCalledTimes(2)
  })

  it('clears the note when saved blank and shows an error when saving fails', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([{ ...openOrder, notes: 'vieja' }])
    vi.mocked(setOrderNotes).mockRejectedValueOnce(new Error('No se pudo guardar la nota.'))
    const user = userEvent.setup()
    renderPage()
    await openOrdersSheet(user)
    await user.click(screen.getByRole('button', { name: /editar nota/i }))
    const dialog = screen.getByRole('dialog', { name: /nota del pedido/i })
    await user.clear(within(dialog).getByLabelText('Nota del pedido'))
    await user.click(within(dialog).getByRole('button', { name: /guardar nota/i }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No se pudo guardar la nota.')
    await user.click(within(dialog).getByRole('button', { name: /guardar nota/i }))
    expect(setOrderNotes).toHaveBeenLastCalledWith('order-1', null)
    expect(setOrderNotes).toHaveBeenCalledTimes(2)
  })

  it('creates orders without any waiter gate', async () => {
    const user = userEvent.setup()
    renderPage()
    await reachReview(user)
    await user.click(screen.getByRole('button', { name: /enviar a cocina/i }))
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/^Mesero:/)).not.toBeInTheDocument()
  })
})

async function finishPizza(user: ReturnType<typeof userEvent.setup>) {
  const dialog = screen.getByRole('dialog', { name: /armar pizza/i })
  for (let i = 0; i < 6 && !within(dialog).queryByRole('button', { name: 'Agregar pizza' }); i++) {
    await user.click(within(dialog).getByRole('button', { name: /^Siguiente/ }))
  }
  await user.click(within(dialog).getByRole('button', { name: 'Agregar pizza' }))
}

describe('built pizzas, notes and variants in the order', () => {
  async function buildPizza(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: /armar pizza/i }))
    await finishPizza(user)
  }

  it('does not offer the builder when the pizza catalog has no sizes', async () => {
    const user = userEvent.setup()
    renderPage()
    await startOrder(user, { table: 4 })
    await screen.findByRole('button', { name: 'Pizza queso' })
    expect(screen.queryByRole('button', { name: /armar pizza/i })).not.toBeInTheDocument()
  })

  it('builds a pizza and sends it as a pizza line with its note', async () => {
    vi.mocked(listPizzaCatalog).mockResolvedValue(pizzaCatalogFixture)
    const user = userEvent.setup()
    renderPage()
    await startOrder(user, { table: 6 })
    await buildPizza(user)
    await user.click(screen.getByRole('button', { name: /revisar pedido/i }))
    const line = screen.getByRole('group', { name: 'Cantidad de Pizza Chica: Estilo Varas' }).closest('li')!
    expect(within(line).getByText('Pizza Chica')).toBeVisible()
    expect(within(line).getByText('Estilo Varas')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Agregar nota a Pizza Chica: Estilo Varas' }))
    await user.type(screen.getByRole('textbox', { name: 'Nota para Pizza Chica: Estilo Varas' }), '  sin orilla ')
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    await user.click(screen.getByRole('button', { name: /enviar a cocina/i }))
    expect(createOrder).toHaveBeenCalledWith({
      tableNumber: 6,
      customerName: null,
      items: [
        {
          type: 'pizza',
          pizza: { size: 'chica', portions: [{ styleId: 'varas', ingredientIds: [], extraIngredientIds: [] }], extraIds: [] },
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
    await startOrder(user, { table: 4 })
    await buildPizza(user)
    await buildPizza(user)
    expect(within(screen.getByRole('button', { name: /armar pizza/i })).getByText('×2')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /revisar pedido/i }))
    expect(screen.getAllByText('Estilo Varas')).toHaveLength(2)
  })

  it('adds a built pizza to an existing order', async () => {
    vi.mocked(listPizzaCatalog).mockResolvedValue(pizzaCatalogFixture)
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^pedidos abiertos/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /agregar productos/i }))
    await buildPizza(user)
    await user.click(screen.getByRole('button', { name: /revisar pedido/i }))
    await user.click(screen.getByRole('button', { name: 'Agregar al pedido' }))
    expect(addOrderItems).toHaveBeenCalledWith('order-1', [expect.objectContaining({ type: 'pizza', quantity: 1 })])
  })

  it('keeps noted lines separate from plain ones', async () => {
    const user = userEvent.setup()
    renderPage()
    await reachReview(user, { table: 1 })
    await user.click(screen.getByRole('button', { name: 'Agregar nota a Pizza queso' }))
    await user.type(screen.getByRole('textbox', { name: 'Nota para Pizza queso' }), 'sin cebolla')
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    await user.click(within(stepItem('Productos')).getByRole('button', { name: 'Productos' }))
    await user.click(screen.getByRole('button', { name: 'Pizza queso' }))
    await user.click(screen.getByRole('button', { name: /revisar pedido/i }))
    expect(screen.getAllByRole('group', { name: 'Cantidad de Pizza queso' })).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /enviar a cocina/i }))
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          { type: 'product', productId: 'p', quantity: 1, notes: 'sin cebolla' },
          { type: 'product', productId: 'p', quantity: 1 },
        ],
      }),
    )
  })

  describe('products with variants', () => {
    beforeEach(() => {
      vi.mocked(listCategories).mockResolvedValue([{ id: 'burgers', name: 'Hamburguesas', sortOrder: 0 }])
      vi.mocked(listProducts).mockResolvedValue([
        { id: 'b', categoryId: 'burgers', name: 'Hamburguesa', priceCents: 9000, active: true, variants: ['Res', 'Pollo'] },
        { id: 'p', categoryId: 'burgers', name: 'Papas', priceCents: 4000, active: true, variants: [] },
      ])
    })

    async function pick(user: ReturnType<typeof userEvent.setup>, variant: string) {
      const choices = await screen.findByRole('group', { name: 'Elige: Hamburguesa' })
      await user.click(within(choices).getByRole('button', { name: new RegExp(`^${variant}`) }))
    }

    it('sends the chosen variant and merges taps on the same one', async () => {
      const user = userEvent.setup()
      renderPage()
      await startOrder(user, { table: 1 })
      await pick(user, 'Pollo')
      await pick(user, 'Pollo')
      await user.click(screen.getByRole('button', { name: /revisar pedido/i }))
      expect(screen.getAllByRole('group', { name: /^Cantidad de Hamburguesa/ })).toHaveLength(1)
      expect(screen.getByRole('group', { name: 'Cantidad de Hamburguesa (Pollo)' })).toBeVisible()
      await user.click(screen.getByRole('button', { name: /enviar a cocina/i }))
      expect(createOrder).toHaveBeenCalledWith({
        tableNumber: 1,
        customerName: null,
        items: [{ type: 'product', productId: 'b', quantity: 2, variant: 'Pollo' }],
        notes: null,
        scheduledFor: null,
        service: 'dine_in',
      })
    })

    it('keeps different variants as separate lines', async () => {
      const user = userEvent.setup()
      renderPage()
      await startOrder(user, { table: 1 })
      await pick(user, 'Res')
      await pick(user, 'Pollo')
      await user.click(screen.getByRole('button', { name: /revisar pedido/i }))
      expect(screen.getByRole('group', { name: 'Cantidad de Hamburguesa (Res)' })).toBeVisible()
      expect(screen.getByRole('group', { name: 'Cantidad de Hamburguesa (Pollo)' })).toBeVisible()
    })
  })
})

/** The table tile of M-n (its name also carries Libre/Ocupada and the order detail). */
function tableTile(n: number) {
  return screen.getByRole('button', { name: new RegExp(`^M-${n}\\b`) })
}

function stepItem(label: string) {
  return within(screen.getByRole('navigation', { name: 'Pasos del pedido' })).getByText(label).closest('li')!
}

describe('guided steps: step indicator and Mesa step', () => {
  const at = (h: number, m: number) => new Date(`2026-01-01T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`)

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the three steps with Mesa as the current one', async () => {
    renderPage()
    await screen.findByRole('heading', { name: '¿Dónde es el pedido?' })
    const nav = screen.getByRole('navigation', { name: 'Pasos del pedido' })
    const items = within(nav).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['1 Mesa', '2 Productos', '3 Revisar'])
    expect(stepItem('Mesa')).toHaveAttribute('aria-current', 'step')
    expect(stepItem('Productos')).not.toHaveAttribute('aria-current')
    expect(within(nav).queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the Aquí / Para llevar toggle and the table map with Libre and Ocupada by text', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(10, 25))
    vi.mocked(listOpenOrders).mockResolvedValue([{ ...openOrder, token: 7, waiterName: 'Jorge' }])
    renderPage()
    await screen.findByRole('heading', { name: 'Elige la mesa' })
    const service = screen.getByRole('group', { name: 'Tipo de pedido' })
    expect(within(service).getByRole('button', { name: 'Aquí' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(service).getByRole('button', { name: 'Para llevar' })).toHaveAttribute('aria-pressed', 'false')

    const map = screen.getByRole('group', { name: 'Mesa' })
    expect(within(map).getAllByRole('button')).toHaveLength(9)
    expect(tableTile(1)).toHaveTextContent('Libre')
    expect(tableTile(3)).toHaveTextContent('Ocupada')
    expect(tableTile(3)).toHaveTextContent('Ficha 7 · 25 min · Jorge')
    expect(tableTile(3)).toHaveClass('min-h-[104px]')
  })

  it('shows a scheduled table with its time instead of the Sin ficha line', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(10, 25))
    vi.mocked(listOpenOrders).mockResolvedValue([
      { ...openOrder, token: null, waiterName: 'Jorge', scheduledFor: at(14, 30).toISOString(), queuedAt: null },
    ])
    renderPage()
    await screen.findByRole('heading', { name: 'Elige la mesa' })
    expect(tableTile(3)).toHaveTextContent('Ocupada')
    expect(tableTile(3)).toHaveTextContent(/Programado \d{1,2}:30/)
    expect(tableTile(3)).not.toHaveTextContent('Sin ficha')
    expect(tableTile(3)).toHaveTextContent('Jorge')
  })

  it('explains the chosen table under the map, and lets the table be unchosen', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^M-4\b/ }))
    expect(tableTile(4)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('M-4 está libre. Se abrirá un pedido nuevo.')).toBeVisible()
    await user.click(tableTile(4))
    expect(tableTile(4)).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText(/está libre/)).not.toBeInTheDocument()
  })

  it('offers Agregar a este pedido on an occupied table, entering add mode at step 2', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(10, 25))
    vi.mocked(listOpenOrders).mockResolvedValue([{ ...openOrder, token: 7, waiterName: 'Jorge' }])
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^M-3\b/ }))
    expect(screen.getByText('M-3 ocupada · Ficha 7 · 25 min · Jorge')).toBeVisible()
    expect(screen.getByRole('button', { name: /siguiente: productos/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Agregar a este pedido' }))
    expect(stepItem('Productos')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('region', { name: /pedido en edición/i })).toHaveTextContent('Agregando al pedido M-3 · Ana')
    expect(screen.queryByRole('heading', { name: '¿Dónde es el pedido?' })).not.toBeInTheDocument()
  })

  it('enables Siguiente only with a service and a table or a valid name, and says what is missing', async () => {
    const user = userEvent.setup()
    renderPage()
    const next = await screen.findByRole('button', { name: /siguiente: productos/i })
    expect(next).toBeDisabled()
    expect(screen.getByText('Falta: elegir Aquí o Para llevar')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Aquí' }))
    expect(next).toBeDisabled()
    expect(screen.getByText('Falta: mesa o nombre del cliente')).toBeVisible()
    await user.type(screen.getByLabelText(/nombre del cliente/i), '   ')
    expect(next).toBeDisabled()
    await user.click(tableTile(5))
    expect(next).toBeEnabled()
    expect(screen.queryByText(/^Falta:/)).not.toBeInTheDocument()
    await user.click(tableTile(5))
    await user.type(screen.getByLabelText(/nombre del cliente/i), ' Juan ')
    expect(next).toBeEnabled()
  })

  it('asks for the customer name on takeaway orders, which do not take a table', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Aquí' }))
    await user.click(tableTile(5))
    expect(screen.getByLabelText(/nombre del cliente \(opcional en mesa · obligatorio para llevar\)/i)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Para llevar' }))
    expect(screen.queryByRole('group', { name: 'Mesa' })).not.toBeInTheDocument()
    const next = screen.getByRole('button', { name: /siguiente: productos/i })
    expect(next).toBeDisabled()
    expect(screen.getByText('Falta: nombre del cliente')).toBeVisible()
    expect(screen.getByLabelText(/nombre del cliente \(obligatorio para llevar\)/i)).toBeVisible()
    await user.type(screen.getByLabelText(/nombre del cliente/i), 'Luis')
    expect(next).toBeEnabled()
  })

  it('goes to Productos with Siguiente, keeps the choices and lets Mesa be tapped to go back', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Aquí' }))
    await user.click(tableTile(4))
    await user.type(screen.getByLabelText(/nombre del cliente/i), 'Familia Ortega')
    await user.click(screen.getByRole('button', { name: /siguiente: productos/i }))
    expect(stepItem('Productos')).toHaveAttribute('aria-current', 'step')
    expect(stepItem('Mesa')).toHaveTextContent('✓ Mesa')
    expect(screen.queryByRole('heading', { name: '¿Dónde es el pedido?' })).not.toBeInTheDocument()

    await user.click(within(stepItem('Mesa')).getByRole('button', { name: 'Mesa' }))
    expect(stepItem('Mesa')).toHaveAttribute('aria-current', 'step')
    expect(tableTile(4)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText(/nombre del cliente/i)).toHaveValue('Familia Ortega')
    expect(screen.getByRole('button', { name: 'Aquí' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps open orders, including takeaway ones without table, reachable from step 1', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([
      openOrder,
      { ...openOrder, id: 'order-2', tableNumber: null, customerName: 'Beto', service: 'takeaway' },
    ])
    const user = userEvent.setup()
    renderPage()
    const opener = await screen.findByRole('button', { name: /^pedidos abiertos/i })
    expect(opener).toHaveTextContent('2')
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Pedidos abiertos' })
    expect(within(dialog).getByText('Beto')).toBeVisible()
    expect(within(dialog).getAllByRole('button', { name: /agregar productos/i })).toHaveLength(2)
    expect(within(dialog).getAllByRole('link', { name: /cobrar/i })).toHaveLength(2)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('starts adding from the open orders sheet and jumps to step 2', async () => {
    vi.mocked(listOpenOrders).mockResolvedValue([{ ...openOrder, id: 'order-2', tableNumber: null, customerName: 'Beto' }])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^pedidos abiertos/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /agregar productos/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(stepItem('Productos')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('region', { name: /pedido en edición/i })).toHaveTextContent('Agregando al pedido Beto')
  })

  it('cancels an open order only after confirming, from the open orders sheet', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^pedidos abiertos/i }))
    await user.click(within(screen.getByRole('dialog', { name: 'Pedidos abiertos' })).getByRole('button', { name: /cancelar pedido/i }))
    expect(cancelOrder).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Pedidos abiertos' })).toBeVisible()
    await user.click(within(screen.getByRole('dialog', { name: 'Cancelar pedido' })).getByRole('button', { name: /sí, cancelar pedido/i }))
    expect(cancelOrder).toHaveBeenCalledWith('order-1')
  })

  it('places the step bar above the bottom nav only when asked to', async () => {
    renderPage()
    const next = await screen.findByRole('button', { name: /siguiente: productos/i })
    expect(next.closest('[data-step-bar]')).toHaveClass('bottom-[calc(68px+env(safe-area-inset-bottom))]', 'sm:bottom-0')
  })
})

/** Walks step 1 with the given choices and lands on step 2. */
async function startOrder(
  user: ReturnType<typeof userEvent.setup>,
  { service = 'Aquí', table, name }: { service?: 'Aquí' | 'Para llevar'; table?: number; name?: string } = {},
) {
  await user.click(await screen.findByRole('button', { name: service }))
  if (table !== undefined) await user.click(tableTile(table))
  if (name !== undefined) await user.type(screen.getByLabelText(/nombre del cliente/i), name)
  await user.click(screen.getByRole('button', { name: /siguiente: productos/i }))
}

describe('guided steps: Productos step', () => {
  it('shows the sticky context bar with table, service and name, and Cambiar goes back to step 1', async () => {
    const user = userEvent.setup()
    renderPage()
    await startOrder(user, { table: 4, name: 'Familia Ortega' })
    const context = screen.getByRole('region', { name: 'Contexto del pedido' })
    expect(context).toHaveTextContent('M-4 · Aquí · Familia Ortega')
    expect(context.parentElement).toHaveClass('sticky')
    await user.click(within(context).getByRole('button', { name: 'Cambiar' }))
    expect(stepItem('Mesa')).toHaveAttribute('aria-current', 'step')
    expect(tableTile(4)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText(/nombre del cliente/i)).toHaveValue('Familia Ortega')
  })

  it('names a takeaway order without a table in the context bar', async () => {
    const user = userEvent.setup()
    renderPage()
    await startOrder(user, { service: 'Para llevar', name: 'Luis' })
    expect(screen.getByRole('region', { name: 'Contexto del pedido' })).toHaveTextContent('Para llevar · Luis')
  })

  it('has search, category pills and product tiles of at least 64px, with a ×N badge once added', async () => {
    const user = userEvent.setup()
    renderPage()
    await startOrder(user, { table: 4 })
    expect(screen.getByRole('searchbox', { name: 'Buscar producto por nombre' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Botanas' })).toHaveClass('min-h-11')
    const tile = await screen.findByRole('button', { name: 'Pizza queso' })
    expect(tile).toHaveClass('min-h-16')
    expect(tile).not.toHaveTextContent('$')
    await user.click(tile)
    await user.click(tile)
    expect(screen.getByText('×2')).toBeVisible()
  })

  it('chooses a variant inline on the tile instead of opening a dialog', async () => {
    vi.mocked(listProducts).mockResolvedValue([
      { id: 'b', categoryId: 'pizza', name: 'Hamburguesa', priceCents: 9000, active: true, variants: ['Res', 'Pollo'] },
    ])
    const user = userEvent.setup()
    renderPage()
    await startOrder(user, { table: 4 })
    const choices = await screen.findByRole('group', { name: 'Elige: Hamburguesa' })
    await user.click(within(choices).getByRole('button', { name: 'Pollo' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /revisar pedido/i })).toHaveTextContent('1 producto')
  })

  it('shows the sticky bottom bar with the product count, disabled until there is one', async () => {
    const user = userEvent.setup()
    renderPage()
    await startOrder(user, { table: 4 })
    const bar = await screen.findByRole('button', { name: /revisar pedido/i })
    expect(bar).toBeDisabled()
    expect(bar).toHaveTextContent('Agrega productos')
    await user.click(screen.getByRole('button', { name: 'Pizza queso' }))
    expect(bar).toBeEnabled()
    expect(bar).toHaveTextContent('1 producto')
    expect(bar).toHaveTextContent('Revisar pedido →')
    await user.click(screen.getByRole('button', { name: 'Pizza queso' }))
    await user.click(screen.getByRole('button', { name: 'Pizza queso' }))
    expect(bar).toHaveTextContent('3 productos')
    expect(bar.closest('[data-step-bar]')).toHaveClass('bottom-[calc(68px+env(safe-area-inset-bottom))]')

    await user.click(bar)
    expect(stepItem('Revisar')).toHaveAttribute('aria-current', 'step')
  })

  it('offers a prominent Armar pizza tile that opens the builder and counts the pizzas added', async () => {
    vi.mocked(listPizzaCatalog).mockResolvedValue(pizzaCatalogFixture)
    const user = userEvent.setup()
    renderPage()
    await startOrder(user, { table: 4 })
    const armar = await screen.findByRole('button', { name: /armar pizza/i })
    expect(armar).toHaveClass('min-h-[68px]')
    await user.click(armar)
    await finishPizza(user)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(armar).getByText('×1')).toBeVisible()
    expect(screen.getByRole('button', { name: /revisar pedido/i })).toHaveTextContent('1 producto')
  })

  it('keeps adding to an open order: context names it and products can be added', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^pedidos abiertos/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /agregar productos/i }))
    expect(screen.getByRole('region', { name: /pedido en edición/i })).toHaveTextContent('Agregando al pedido M-3 · Ana')
    expect(screen.queryByRole('region', { name: 'Contexto del pedido' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Pizza queso' }))
    expect(screen.getByRole('button', { name: /revisar pedido/i })).toHaveTextContent('1 producto')
    expect(within(stepItem('Mesa')).queryByRole('button')).not.toBeInTheDocument()
  })

  it('hides products of the legacy Pizzas category and its pill', async () => {
    vi.mocked(listCategories).mockResolvedValue([
      { id: 'pizza', name: ' pizzas ', sortOrder: 0, legacyPizza: true },
      { id: 'snacks', name: 'Botanas', sortOrder: 1 },
    ])
    vi.mocked(listProducts).mockResolvedValue([
      { id: 'p', categoryId: 'pizza', name: 'Pizza queso', priceCents: 0, active: true, variants: [] },
      { id: 'a', categoryId: 'snacks', name: 'Alitas', priceCents: 0, active: true, variants: [] },
    ])
    const user = userEvent.setup()
    renderPage()
    await startOrder(user, { table: 4 })
    expect(await screen.findByRole('button', { name: 'Alitas' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^pizzas$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pizza queso/i })).not.toBeInTheDocument()
  })

  it('shows a sold-out product as Agotado, disabled', async () => {
    vi.mocked(listProducts).mockResolvedValue([
      { id: 'soda', categoryId: 'pizza', name: 'Refresco', priceCents: 2000, active: true, variants: [], trackStock: true, stock: 0, stockMin: 6 },
    ])
    const user = userEvent.setup()
    renderPage()
    await startOrder(user, { table: 4 })
    const soda = await screen.findByRole('button', { name: /Refresco/ })
    expect(soda).toBeDisabled()
    expect(within(soda).getByText('Agotado')).toBeVisible()
  })
})

/** Walks steps 1 and 2 (one tap on the first product `taps` times) and lands on step 3. */
async function reachReview(
  user: ReturnType<typeof userEvent.setup>,
  { table = 4, taps = 1, product = 'Pizza queso', ...rest }: { table?: number; taps?: number; product?: string; service?: 'Aquí' | 'Para llevar'; name?: string } = {},
) {
  await startOrder(user, { table: rest.service === 'Para llevar' ? undefined : table, service: rest.service, name: rest.name })
  const tile = await screen.findByRole('button', { name: product })
  for (let i = 0; i < taps; i++) await user.click(tile)
  await user.click(screen.getByRole('button', { name: /revisar pedido/i }))
}

describe('guided steps: Revisar step', () => {
  it('shows the context summary with Cambiar, which goes back to step 1', async () => {
    const user = userEvent.setup()
    renderPage()
    await reachReview(user, { name: 'Familia Ortega' })
    expect(stepItem('Revisar')).toHaveAttribute('aria-current', 'step')
    expect(stepItem('Productos')).toHaveTextContent('✓ Productos')
    const context = screen.getByRole('region', { name: 'Contexto del pedido' })
    expect(context).toHaveTextContent('M-4 · Aquí · Familia Ortega')
    await user.click(within(context).getByRole('button', { name: 'Cambiar' }))
    expect(stepItem('Mesa')).toHaveAttribute('aria-current', 'step')
  })

  it('lets Productos be tapped to go back and keeps the lines', async () => {
    const user = userEvent.setup()
    renderPage()
    await reachReview(user)
    await user.click(within(stepItem('Productos')).getByRole('button', { name: 'Productos' }))
    expect(screen.getByText('×1')).toBeVisible()
  })

  it('edits each line with a large − qty +, where − stops at 1 because Quitar removes', async () => {
    const user = userEvent.setup()
    renderPage()
    await reachReview(user)
    const stepper = screen.getByRole('group', { name: 'Cantidad de Pizza queso' })
    const less = within(stepper).getByRole('button', { name: 'Quitar uno' })
    const more = within(stepper).getByRole('button', { name: 'Agregar uno' })
    expect(less).toHaveAccessibleName('Quitar uno')
    expect(more).toHaveAccessibleName('Agregar uno')
    for (const button of [less, more]) expect(button).toHaveClass('h-12', 'w-12')
    expect(within(stepper).getByText('1')).toBeVisible()
    expect(less).toBeDisabled()
    await user.click(more)
    expect(within(stepper).getByText('2')).toBeVisible()
    expect(less).toBeEnabled()
    await user.click(less)
    expect(within(stepper).getByText('1')).toBeVisible()
  })

  it('adds and edits a line note through Agregar nota / Editar nota and sends it', async () => {
    const user = userEvent.setup()
    renderPage()
    await reachReview(user)
    expect(screen.queryByRole('textbox', { name: 'Nota para Pizza queso' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Agregar nota a Pizza queso' }))
    const field = screen.getByRole('textbox', { name: 'Nota para Pizza queso' })
    expect(field).toHaveFocus()
    expect(field).toHaveAttribute('maxlength', '200')
    await user.type(field, '  sin cebolla {Enter}')
    expect(createOrder).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Nota para Pizza queso' })).not.toBeInTheDocument()
    expect(screen.getByText('Nota: sin cebolla')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Editar nota a Pizza queso' }))
    expect(screen.getByRole('textbox', { name: 'Nota para Pizza queso' })).toHaveValue('  sin cebolla ')
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    await user.click(screen.getByRole('button', { name: /enviar a cocina/i }))
    expect(createOrder).toHaveBeenCalledWith({
      tableNumber: 4,
      customerName: null,
      items: [{ type: 'product', productId: 'p', quantity: 1, notes: 'sin cebolla' }],
      notes: null,
      scheduledFor: null,
      service: 'dine_in',
    })
  })

  describe('removing lines', () => {
    beforeEach(() => {
      vi.mocked(listProducts).mockResolvedValue([
        { id: 'p', categoryId: 'pizza', name: 'Pizza queso', priceCents: 15000, active: true, variants: [] },
        { id: 'g', categoryId: 'pizza', name: 'Papas gajo', priceCents: 6000, active: true, variants: [] },
      ])
    })

    async function twoLines(user: ReturnType<typeof userEvent.setup>) {
      await startOrder(user, { table: 4 })
      await user.click(await screen.findByRole('button', { name: 'Pizza queso' }))
      await user.click(screen.getByRole('button', { name: 'Papas gajo' }))
      await user.click(screen.getByRole('button', { name: 'Papas gajo' }))
      await user.click(screen.getByRole('button', { name: /revisar pedido/i }))
    }

    it('shows an announced undo snackbar after Quitar and restores the line, quantity and note with Deshacer', async () => {
      const user = userEvent.setup()
      renderPage()
      await twoLines(user)
      await user.click(screen.getByRole('button', { name: 'Agregar nota a Pizza queso' }))
      await user.type(screen.getByRole('textbox', { name: 'Nota para Pizza queso' }), 'bien cocida')
      await user.click(screen.getByRole('button', { name: 'Listo' }))
      expect(screen.queryByRole('status')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Quitar Pizza queso del pedido' }))
      const snack = screen.getByRole('status')
      expect(snack).toHaveTextContent('Quitaste Pizza queso')
      expect(screen.queryByRole('group', { name: 'Cantidad de Pizza queso' })).not.toBeInTheDocument()
      expect(screen.getByRole('group', { name: 'Cantidad de Papas gajo' })).toBeVisible()

      await user.click(within(snack).getByRole('button', { name: 'Deshacer' }))
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      const lines = screen.getAllByRole('group', { name: /^Cantidad de/ })
      expect(lines.map((line) => line.getAttribute('aria-label'))).toEqual(['Cantidad de Pizza queso', 'Cantidad de Papas gajo'])
      expect(screen.getByText('Nota: bien cocida')).toBeVisible()
    })

    it('lists what is missing and blocks sending when the last line is removed, and Deshacer fixes it', async () => {
      const user = userEvent.setup()
      renderPage()
      await reachReview(user)
      const send = screen.getByRole('button', { name: /enviar a cocina/i })
      expect(send).toBeEnabled()
      const checklist = screen.getByRole('list', { name: 'Lista de verificación' })
      expect(within(checklist).queryByText(/^Falta:/)).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Quitar Pizza queso del pedido' }))
      expect(within(checklist).getByText('Falta: agregar productos')).toBeVisible()
      expect(send).toBeDisabled()
      await user.click(screen.getByRole('button', { name: 'Deshacer' }))
      expect(within(checklist).queryByText(/^Falta:/)).not.toBeInTheDocument()
      expect(send).toBeEnabled()
    })

    it('only keeps the last removal undoable and drops the snackbar when the step changes', async () => {
      const user = userEvent.setup()
      renderPage()
      await twoLines(user)
      await user.click(screen.getByRole('button', { name: 'Quitar Pizza queso del pedido' }))
      await user.click(screen.getByRole('button', { name: 'Quitar Papas gajo del pedido' }))
      expect(screen.getByRole('status')).toHaveTextContent('Quitaste Papas gajo')
      await user.click(within(stepItem('Productos')).getByRole('button', { name: 'Productos' }))
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('dismisses the snackbar after the undo window', async () => {
      const user = userEvent.setup()
      renderPage()
      await reachReview(user)
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        fireEvent.click(screen.getByRole('button', { name: 'Quitar Pizza queso del pedido' }))
        expect(screen.getByRole('status')).toHaveTextContent('Quitaste Pizza queso')
        act(() => {
          vi.advanceTimersByTime(8000)
        })
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('asks for the order note and the pickup time, and sends both', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0))
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderPage()
      await reachReview(user)
      const note = screen.getByLabelText('Nota del pedido (opcional)')
      expect(note).toHaveAttribute('maxlength', '300')
      await user.type(note, '  cliente alérgico ')
      await user.type(screen.getByLabelText('Hora para recoger (opcional)'), '14:30')
      await user.click(screen.getByRole('button', { name: /enviar a cocina/i }))
      expect(createOrder).toHaveBeenCalledWith({
        tableNumber: 4,
        customerName: null,
        items: [{ type: 'product', productId: 'p', quantity: 1 }],
        notes: 'cliente alérgico',
        scheduledFor: new Date(2026, 9, 21, 14, 30).toISOString(),
        service: 'dine_in',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a pickup time that is not later today and keeps the draft', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0))
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderPage()
      await reachReview(user)
      await user.type(screen.getByLabelText('Hora para recoger (opcional)'), '11:00')
      await user.click(screen.getByRole('button', { name: /enviar a cocina/i }))
      expect(await screen.findByRole('alert')).toHaveTextContent('La hora del pedido debe ser más tarde hoy.')
      expect(createOrder).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Hora para recoger (opcional)')).toHaveValue('11:00')
      expect(screen.getByRole('group', { name: 'Cantidad de Pizza queso' })).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends with Enviar a cocina, confirms, refreshes the open orders and starts over at step 1', async () => {
    const user = userEvent.setup()
    renderPage()
    await reachReview(user, { taps: 2, name: '  Luis   Perez ' })
    await user.click(screen.getByRole('button', { name: /enviar a cocina/i }))
    expect(createOrder).toHaveBeenCalledWith({
      tableNumber: 4,
      customerName: 'Luis Perez',
      items: [{ type: 'product', productId: 'p', quantity: 2 }],
      notes: null,
      scheduledFor: null,
      service: 'dine_in',
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Pedido registrado correctamente.')
    expect(listOpenOrders).toHaveBeenCalledTimes(2)
    expect(stepItem('Mesa')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByLabelText(/nombre del cliente/i)).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Aquí' })).toHaveAttribute('aria-pressed', 'false')
    expect(tableTile(4)).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /siguiente: productos/i })).toBeDisabled()
  })

  it('shows an error banner and keeps the draft when sending fails', async () => {
    vi.mocked(createOrder).mockRejectedValueOnce(new Error('No se pudo crear el pedido.'))
    const user = userEvent.setup()
    renderPage()
    await reachReview(user)
    await user.click(screen.getByRole('button', { name: /enviar a cocina/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo crear el pedido.')
    expect(screen.getByRole('button', { name: /enviar a cocina/i })).toBeEnabled()
    expect(screen.getByRole('group', { name: 'Cantidad de Pizza queso' })).toBeVisible()
  })

  it('sends a takeaway order with the customer name and no table', async () => {
    const user = userEvent.setup()
    renderPage()
    await reachReview(user, { service: 'Para llevar', name: 'Luis' })
    expect(screen.getByRole('region', { name: 'Contexto del pedido' })).toHaveTextContent('Para llevar · Luis')
    await user.click(screen.getByRole('button', { name: /enviar a cocina/i }))
    expect(createOrder).toHaveBeenCalledWith({
      tableNumber: null,
      customerName: 'Luis',
      items: [{ type: 'product', productId: 'p', quantity: 1 }],
      notes: null,
      scheduledFor: null,
      service: 'takeaway',
    })
  })

  it('sends to a table without a name', async () => {
    const user = userEvent.setup()
    renderPage()
    await reachReview(user, { table: 5 })
    await user.click(screen.getByRole('button', { name: /enviar a cocina/i }))
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ tableNumber: 5, customerName: null, service: 'dine_in' }))
  })

  it('places the send bar above the bottom nav', async () => {
    const user = userEvent.setup()
    renderPage()
    await reachReview(user)
    expect(screen.getByRole('button', { name: /enviar a cocina/i }).closest('[data-step-bar]')).toHaveClass(
      'bottom-[calc(68px+env(safe-area-inset-bottom))]',
    )
  })

  describe('adding to an open order', () => {
    async function addToOpenOrder(user: ReturnType<typeof userEvent.setup>) {
      await user.click(await screen.findByRole('button', { name: /^pedidos abiertos/i }))
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /agregar productos/i }))
      await user.click(await screen.findByRole('button', { name: 'Pizza queso' }))
      await user.click(screen.getByRole('button', { name: /revisar pedido/i }))
    }

    it('reviews the new products only, without order note or pickup time, and adds them', async () => {
      const user = userEvent.setup()
      renderPage()
      await addToOpenOrder(user)
      expect(screen.getByRole('region', { name: /pedido en edición/i })).toHaveTextContent('Agregando al pedido M-3 · Ana')
      expect(screen.queryByLabelText(/nota del pedido/i)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/hora para recoger/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /enviar a cocina/i })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Agregar al pedido' }))
      expect(addOrderItems).toHaveBeenCalledWith('order-1', [{ type: 'product', productId: 'p', quantity: 1 }])
      expect(createOrder).not.toHaveBeenCalled()
      expect(await screen.findByRole('status')).toHaveTextContent('Productos agregados al pedido.')
      expect(stepItem('Mesa')).toHaveAttribute('aria-current', 'step')
    })

    it('can leave the add mode from the review without calling the server', async () => {
      const user = userEvent.setup()
      renderPage()
      await addToOpenOrder(user)
      await user.click(screen.getByRole('button', { name: 'Cancelar edición' }))
      expect(stepItem('Mesa')).toHaveAttribute('aria-current', 'step')
      expect(screen.queryByRole('region', { name: /pedido en edición/i })).not.toBeInTheDocument()
      expect(addOrderItems).not.toHaveBeenCalled()
    })
  })
})
