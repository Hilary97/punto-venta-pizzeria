import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KitchenOrder, KitchenSource } from '../domain/kitchen'
import { KitchenBoard } from './KitchenBoard'

function order(overrides: Partial<KitchenOrder> = {}): KitchenOrder {
  return {
    id: 'o1',
    token: 7,
    tableNumber: 4,
    customerName: 'Ana',
    waiterName: 'Carlos',
    notes: 'Sin cebolla en todo',
    createdAt: '2026-01-01T15:05:00Z',
    lines: [
      { id: 'l1', productName: 'Hamburguesa', quantity: 2, type: 'product', pizza: null, notes: 'Bien cocida', variant: 'Doble' },
    ],
    ...overrides,
  }
}

function makeSource(orders: KitchenOrder[][] = [[order()]]): KitchenSource & {
  listOrders: ReturnType<typeof vi.fn>
  markReady: ReturnType<typeof vi.fn>
} {
  const list = vi.fn()
  for (const batch of orders) list.mockResolvedValueOnce(batch)
  list.mockResolvedValue(orders[orders.length - 1])
  return { listOrders: list, markReady: vi.fn().mockResolvedValue('o1') }
}

/** Adds a fake realtime subscription; `signal()` simulates a change broadcast. */
function withRealtime<T extends object>(source: T) {
  let notify: (() => void) | null = null
  const unsubscribe = vi.fn()
  const subscribe = vi.fn((onChange: () => void) => {
    notify = onChange
    return unsubscribe
  })
  return { source: { ...source, subscribe }, signal: () => notify!(), unsubscribe }
}

describe('KitchenBoard', () => {
  beforeEach(() => vi.useRealTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the order card with every detail', async () => {
    render(<KitchenBoard source={makeSource()} stationLabel="Pizzas" />)
    expect(await screen.findByText('M-4 · Ana')).toBeVisible()
    expect(screen.getByText(/Carlos/)).toBeVisible()
    expect(screen.getByText('2 × Hamburguesa (Doble)')).toBeVisible()
    expect(screen.getByText(/Bien cocida/)).toBeVisible()
    expect(screen.getByText(/Sin cebolla en todo/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Marcar pedido listo' })).toBeEnabled()
  })

  it('shows the arrival time in 12-hour format with am and pm', async () => {
    const at = (h: number, m: number) => new Date(2026, 0, 1, h, m).toISOString()
    const orders = [
      order({ id: 'a', tableNumber: 1, customerName: null, createdAt: at(0, 5) }),
      order({ id: 'b', tableNumber: 2, customerName: null, createdAt: at(9, 30) }),
      order({ id: 'c', tableNumber: 3, customerName: null, createdAt: at(12, 0) }),
      order({ id: 'd', tableNumber: 4, customerName: null, createdAt: at(15, 5) }),
    ]
    render(<KitchenBoard source={makeSource([orders])} stationLabel="Pizzas" />)
    await screen.findByText('M-1')
    for (const time of ['12:05 am', '9:30 am', '12:00 pm', '3:05 pm']) {
      expect(screen.getByText(time)).toBeVisible()
    }
  })

  it('shows the pickup time of a scheduled ticket and nothing for an ordinary one', async () => {
    const scheduledFor = new Date(2026, 9, 21, 14, 30).toISOString()
    const orders = [
      order({ id: 'a', tableNumber: 1, customerName: null, scheduledFor }),
      order({ id: 'b', tableNumber: 2, customerName: null, scheduledFor: null }),
      order({ id: 'c', tableNumber: 3, customerName: null }),
    ]
    render(<KitchenBoard source={makeSource([orders])} stationLabel="Pizzas" />)
    await screen.findByText('M-1')
    expect(screen.getAllByText(/Para las/)).toHaveLength(1)
    expect(screen.getByText('Para las 14:30')).toBeVisible()
  })

  it('lists waiting scheduled orders under Programados, without turn, token or ready button', async () => {
    const queued = order({ id: 'q', tableNumber: 1, customerName: null })
    const waiting = order({
      id: 'w',
      tableNumber: 8,
      customerName: null,
      token: null,
      waiting: true,
      createdAt: '2026-01-01T10:00:00Z',
      scheduledFor: new Date(2026, 0, 1, 14, 30).toISOString(),
    })
    render(<KitchenBoard source={makeSource([[queued, waiting]])} stationLabel="Pizzas" />)

    const queue = await screen.findByRole('list', { name: 'Cola' })
    expect(within(queue).getByText('M-1')).toBeVisible()
    expect(within(queue).queryByText('M-8')).toBeNull()
    expect(within(queue).getAllByLabelText(/^Turno/).map((t) => t.textContent)).toEqual(['#1'])

    const scheduled = screen.getByRole('list', { name: 'Programados' })
    const card = within(scheduled).getByText('M-8').closest('li')!
    expect(within(card).queryByLabelText(/^Turno/)).toBeNull()
    expect(within(card).queryByText(/Ficha|Sin ficha/)).toBeNull()
    expect(within(card).getByText('Programado')).toBeVisible()
    expect(within(card).getByText('Para las 14:30')).toBeVisible()
    expect(within(card).queryByRole('button')).toBeNull()
    expect(card).toHaveAttribute('data-delay', 'ok')
    expect(screen.getAllByRole('button', { name: 'Marcar pedido listo' })).toHaveLength(1)
  })

  it('shows only Programados when nothing is in the queue yet', async () => {
    const waiting = order({ id: 'w', tableNumber: 8, customerName: null, token: null, waiting: true })
    render(<KitchenBoard source={makeSource([[waiting]])} stationLabel="Pizzas" />)
    expect(await screen.findByRole('list', { name: 'Programados' })).toBeVisible()
    expect(screen.queryByRole('list', { name: 'Cola' })).toBeNull()
    expect(screen.queryByText('Sin pedidos en cocina')).toBeNull()
  })

  it('gives a scheduled order its turn once it enters the queue', async () => {
    const waiting = order({ id: 'w', tableNumber: 8, customerName: null, token: null, waiting: true })
    const entered = { ...waiting, token: 3, waiting: false, createdAt: '2026-01-01T15:10:00Z' }
    const first = order({ id: 'q', tableNumber: 1, customerName: null })
    const source = makeSource([[first, waiting], [first, entered]])
    render(<KitchenBoard source={source} stationLabel="Pizzas" />)
    await screen.findByRole('list', { name: 'Programados' })

    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }))
    const queue = await screen.findByRole('list', { name: 'Cola' })
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Programados' })).toBeNull())
    const card = within(queue).getByText('M-8').closest('li')!
    expect(within(card).getByLabelText('Turno 2')).toBeVisible()
    expect(within(card).getByText('Ficha 3')).toBeVisible()
  })

  it('shows the token, or Sin ficha when the order has none', async () => {
    const orders = [order(), order({ id: 'o2', tableNumber: 5, customerName: null, token: null })]
    render(<KitchenBoard source={makeSource([orders])} stationLabel="Pizzas" />)
    const first = (await screen.findByText('M-4 · Ana')).closest('li')!
    expect(within(first).getByText('Ficha 7')).toBeVisible()
    const second = screen.getByText('M-5').closest('li')!
    expect(within(second).getByText('Sin ficha')).toBeVisible()
  })

  it('shows the empty state', async () => {
    render(<KitchenBoard source={makeSource([[]])} stationLabel="Pizzas" />)
    expect(await screen.findByText('Sin pedidos en cocina')).toBeVisible()
  })

  it('shows a load error', async () => {
    const source = makeSource()
    source.listOrders.mockReset().mockRejectedValue(new Error('No se pudieron cargar los pedidos.'))
    render(<KitchenBoard source={source} stationLabel="Pizzas" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar los pedidos.')
  })

  it('lists oldest orders first', async () => {
    const newer = order({ id: 'new', tableNumber: 9, customerName: null, createdAt: '2026-01-01T16:00:00Z' })
    const older = order({ id: 'old', tableNumber: 1, customerName: null, createdAt: '2026-01-01T15:00:00Z' })
    render(<KitchenBoard source={makeSource([[newer, older]])} stationLabel="Pizzas" />)
    await screen.findByText('M-1')
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(titles).toEqual(['M-1', 'M-9'])
  })

  it('numbers the tickets #1, #2 in arrival order', async () => {
    const newer = order({ id: 'new', tableNumber: 9, customerName: null, createdAt: '2026-01-01T16:00:00Z' })
    const older = order({ id: 'old', tableNumber: 1, customerName: null, createdAt: '2026-01-01T15:00:00Z' })
    render(<KitchenBoard source={makeSource([[newer, older]])} stationLabel="Pizzas" />)
    await screen.findByText('M-1')
    const cards = screen.getAllByRole('listitem').filter((li) => li.querySelector('h3'))
    expect(cards.map((card) => within(card).getByLabelText(/^Turno/).textContent)).toEqual(['#1', '#2'])
    expect(within(cards[0]!).getByLabelText('Turno 1')).toBeVisible()
    expect(within(cards[1]!).getByText('M-9')).toBeVisible()
  })

  it('shows two tickets of one order and marks ready only the one tapped', async () => {
    const first = order({ createdAt: '2026-01-01T15:00:00Z' })
    const late = order({
      createdAt: '2026-01-01T15:30:00Z',
      lines: [{ id: 'l2', productName: 'Alitas', quantity: 1, type: 'product', pizza: null, notes: null, variant: null }],
    })
    const source = makeSource([[first, late], [first]])
    render(<KitchenBoard source={source} stationLabel="Pizzas" />)
    expect(await screen.findByText('1 × Alitas')).toBeVisible()
    expect(screen.getAllByText('M-4 · Ana')).toHaveLength(2)

    const buttons = screen.getAllByRole('button', { name: 'Marcar pedido listo' })
    await userEvent.click(buttons[1]!)
    expect(source.markReady).toHaveBeenCalledWith('o1', ['l2'])
    await waitFor(() => expect(screen.queryByText('1 × Alitas')).not.toBeInTheDocument())
    expect(screen.getByText('2 × Hamburguesa (Doble)')).toBeVisible()
    expect(screen.getAllByText('M-4 · Ana')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Marcar pedido listo' })).toBeEnabled()
  })

  it('removes the card optimistically when marked ready', async () => {
    const source = makeSource([[order()], []])
    render(<KitchenBoard source={source} stationLabel="Pizzas" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar pedido listo' }))
    expect(source.markReady).toHaveBeenCalledWith('o1', ['l1'])
    await waitFor(() => expect(screen.queryByText('M-4 · Ana')).not.toBeInTheDocument())
  })

  it('disables the button while pending', async () => {
    const source = makeSource()
    let resolve!: (id: string) => void
    source.markReady.mockReturnValue(new Promise<string>((r) => { resolve = r }))
    render(<KitchenBoard source={source} stationLabel="Pizzas" />)
    const button = await screen.findByRole('button', { name: 'Marcar pedido listo' })
    await userEvent.click(button)
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(source.markReady).toHaveBeenCalledTimes(1)
    await act(async () => resolve('o1'))
  })

  it('shows the error and reloads when marking fails', async () => {
    const source = makeSource()
    source.markReady.mockRejectedValue(new Error('No se pudo marcar el pedido como listo.'))
    render(<KitchenBoard source={source} stationLabel="Pizzas" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar pedido listo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo marcar el pedido como listo.')
    expect(source.listOrders).toHaveBeenCalledTimes(2)
    expect(screen.getByText('M-4 · Ana')).toBeVisible()
  })

  it('reloads with the Actualizar button', async () => {
    const source = makeSource()
    render(<KitchenBoard source={source} stationLabel="Pizzas" />)
    await screen.findByText('M-4 · Ana')
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }))
    expect(source.listOrders).toHaveBeenCalledTimes(2)
  })

  it('polls on the interval and stops on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const source = makeSource()
    const { unmount } = render(<KitchenBoard source={source} stationLabel="Pizzas" pollIntervalMs={1000} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(source.listOrders.mock.calls.length).toBeGreaterThanOrEqual(3)
    unmount()
    const calls = source.listOrders.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(source.listOrders).toHaveBeenCalledTimes(calls)
  })

  it('reloads when the realtime signal arrives', async () => {
    const base = makeSource([[order()], [order(), order({ id: 'o2', tableNumber: 5, customerName: null })]])
    const { source, signal } = withRealtime(base)
    render(<KitchenBoard source={source} stationLabel="Pizzas" />)
    await screen.findByText('M-4 · Ana')
    act(() => signal())
    expect(await screen.findByText('M-5')).toBeVisible()
    expect(base.listOrders).toHaveBeenCalledTimes(2)
  })

  it('merges a burst of realtime signals into one reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const base = makeSource()
    const { source, signal } = withRealtime(base)
    render(<KitchenBoard source={source} stationLabel="Pizzas" />)
    await screen.findByText('M-4 · Ana')
    act(() => {
      signal()
      signal()
      signal()
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(base.listOrders).toHaveBeenCalledTimes(2)
  })

  it('still reloads during a steady stream of realtime signals', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const base = makeSource()
    const { source, signal } = withRealtime(base)
    render(<KitchenBoard source={source} stationLabel="Pizzas" />)
    await screen.findByText('M-4 · Ana')
    for (let i = 0; i < 10; i++) {
      act(() => signal())
      await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    }
    expect(base.listOrders.mock.calls.length).toBeGreaterThanOrEqual(5)
  })

  it('keeps polling every 10 s when the realtime subscription fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const base = makeSource()
    const source = { ...base, subscribe: vi.fn(() => { throw new Error('sin realtime') }) }
    render(<KitchenBoard source={source} stationLabel="Pizzas" />)
    await screen.findByText('M-4 · Ana')
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(base.listOrders).toHaveBeenCalledTimes(2)
  })

  it('polls only every 60 s as a fallback when realtime is available', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const base = makeSource()
    render(<KitchenBoard source={withRealtime(base).source} stationLabel="Pizzas" />)
    await screen.findByText('M-4 · Ana')
    await act(async () => { await vi.advanceTimersByTimeAsync(59_000) })
    expect(base.listOrders).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(base.listOrders).toHaveBeenCalledTimes(2)
  })

  it('keeps polling every 10 s without realtime', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const source = makeSource()
    render(<KitchenBoard source={source} stationLabel="Pizzas" />)
    await screen.findByText('M-4 · Ana')
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(source.listOrders).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes from realtime on unmount', async () => {
    const base = makeSource()
    const { source, unsubscribe } = withRealtime(base)
    const { unmount } = render(<KitchenBoard source={source} stationLabel="Pizzas" />)
    await screen.findByText('M-4 · Ana')
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('turns the card yellow at 15 minutes and red at 25 while the board stays open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-01-01T15:14:00Z'))
    render(<KitchenBoard source={makeSource([[order({ createdAt: '2026-01-01T15:00:00Z' })]])} stationLabel="Pizzas" />)
    const card = (await screen.findByText('M-4 · Ana')).closest('li')!
    expect(card).toHaveAttribute('data-delay', 'ok')
    expect(card).toHaveClass('bg-white')
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(card).toHaveAttribute('data-delay', 'warning')
    expect(card).toHaveClass('bg-yellow-100')
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000) })
    expect(card).toHaveAttribute('data-delay', 'late')
    expect(card).toHaveClass('bg-red-100')
  })

  it('shows the order information in large text so cooks read it fast', async () => {
    render(<KitchenBoard source={makeSource()} stationLabel="Pizzas" />)
    expect(await screen.findByText('M-4 · Ana')).toHaveClass('text-3xl')
    expect(screen.getByText('2 × Hamburguesa (Doble)').closest('ul')).toHaveClass('text-3xl')
    expect(screen.getByText(/Bien cocida/)).toHaveClass('text-xl')
    expect(screen.getByText(/Sin cebolla en todo/)).toHaveClass('text-xl')
  })
})
