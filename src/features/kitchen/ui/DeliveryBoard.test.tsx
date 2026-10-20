import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeliverySource, KitchenOrder } from '../domain/kitchen'
import { DeliveryBoard } from './DeliveryBoard'

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

function makeSource(orders: KitchenOrder[][] = [[order()]]): DeliverySource & {
  listReadyOrders: ReturnType<typeof vi.fn>
  markDelivered: ReturnType<typeof vi.fn>
} {
  const list = vi.fn()
  for (const batch of orders) list.mockResolvedValueOnce(batch)
  list.mockResolvedValue(orders[orders.length - 1])
  return { listReadyOrders: list, markDelivered: vi.fn().mockResolvedValue('o1') }
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

describe('DeliveryBoard', () => {
  beforeEach(() => vi.useRealTimers())
  afterEach(() => vi.useRealTimers())

  const mixed = order({
    lines: [
      { id: 'l1', productName: 'Hamburguesa', quantity: 2, type: 'product', pizza: null, notes: null, variant: null, station: 'grill' },
      { id: 'l2', productName: 'Pizza Hawaiana', quantity: 1, type: 'product', pizza: null, notes: null, variant: null, station: 'pizza' },
      { id: 'l3', productName: 'Refresco', quantity: 1, type: 'product', pizza: null, notes: null, variant: null, station: null },
    ],
  })

  it('lists every line without sections by default', async () => {
    const source = makeSource([[mixed]])
    render(<DeliveryBoard source={source} />)
    expect(await screen.findByText('2 × Hamburguesa')).toBeVisible()
    expect(screen.getByText('1 × Pizza Hawaiana')).toBeVisible()
    expect(screen.getByText('1 × Refresco')).toBeVisible()
    expect(screen.queryAllByRole('group')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Pizzas' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Marcar pedido entregado' }))
    expect(source.markDelivered).toHaveBeenCalledWith('o1', ['l1', 'l2', 'l3'])
  })

  it('shows one section at a time when sectioned, starting with Pizzas', async () => {
    render(<DeliveryBoard source={makeSource([[mixed]])} sectioned />)
    expect(await screen.findByText('1 × Pizza Hawaiana')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Pizzas' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('2 × Hamburguesa')).not.toBeInTheDocument()
    expect(screen.queryByText('1 × Refresco')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Hamburguesas y botanas' }))
    expect(screen.getByText('2 × Hamburguesa')).toBeVisible()
    expect(screen.queryByText('1 × Pizza Hawaiana')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Bebidas y otros' }))
    expect(screen.getByText('1 × Refresco')).toBeVisible()
    expect(screen.queryByText('2 × Hamburguesa')).not.toBeInTheDocument()
  })

  it('hides orders with nothing ready in the selected section', async () => {
    const pizzaOnly = order({
      id: 'o2',
      tableNumber: 9,
      customerName: null,
      lines: [{ id: 'p1', productName: 'Pizza Pepperoni', quantity: 1, type: 'product', pizza: null, notes: null, variant: null, station: 'pizza' }],
    })
    render(<DeliveryBoard source={makeSource([[pizzaOnly]])} sectioned />)
    expect(await screen.findByText('M-9')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Hamburguesas y botanas' }))
    expect(screen.queryByText('M-9')).not.toBeInTheDocument()
    expect(screen.getByText('Sin pedidos listos para entregar')).toBeVisible()
  })

  it('delivers only the section lines and keeps the rest in their section', async () => {
    const source = makeSource([[mixed]])
    let resolve!: (id: string) => void
    source.markDelivered.mockReturnValue(new Promise<string>((r) => { resolve = r }))
    render(<DeliveryBoard source={source} sectioned />)
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar pedido entregado' }))
    expect(source.markDelivered).toHaveBeenCalledWith('o1', ['l2'])
    await act(async () => resolve('o1'))
    await waitFor(() => expect(screen.queryByText('M-4 · Ana')).not.toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Hamburguesas y botanas' }))
    expect(screen.getByText('2 × Hamburguesa')).toBeVisible()
    expect(source.listReadyOrders).toHaveBeenCalledTimes(1)
  })

  it('shows the order card with every detail', async () => {
    render(<DeliveryBoard source={makeSource()} />)
    expect(await screen.findByText('M-4 · Ana')).toBeVisible()
    expect(screen.getByText('Ficha 7')).toBeVisible()
    expect(screen.getByText('2 × Hamburguesa (Doble)')).toBeVisible()
    expect(screen.getByText(/Sin cebolla en todo/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Marcar pedido entregado' })).toHaveTextContent('Entregado')
  })

  it('shows the empty state', async () => {
    render(<DeliveryBoard source={makeSource([[]])} />)
    expect(await screen.findByText('Sin pedidos listos para entregar')).toBeVisible()
  })

  it('shows a load error', async () => {
    const source = makeSource()
    source.listReadyOrders.mockReset().mockRejectedValue(new Error('No se pudieron cargar los pedidos.'))
    render(<DeliveryBoard source={source} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar los pedidos.')
  })

  it('removes the card optimistically when delivered', async () => {
    const source = makeSource([[order()], []])
    render(<DeliveryBoard source={source} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar pedido entregado' }))
    expect(source.markDelivered).toHaveBeenCalledWith('o1', ['l1'])
    await waitFor(() => expect(screen.queryByText('M-4 · Ana')).not.toBeInTheDocument())
  })

  it('disables the button while pending', async () => {
    const source = makeSource()
    let resolve!: (id: string) => void
    source.markDelivered.mockReturnValue(new Promise<string>((r) => { resolve = r }))
    render(<DeliveryBoard source={source} />)
    const button = await screen.findByRole('button', { name: 'Marcar pedido entregado' })
    await userEvent.click(button)
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(source.markDelivered).toHaveBeenCalledTimes(1)
    await act(async () => resolve('o1'))
  })

  it('shows the error and reloads when marking fails', async () => {
    const source = makeSource()
    source.markDelivered.mockRejectedValue(new Error('No se pudo marcar el pedido como entregado.'))
    render(<DeliveryBoard source={source} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar pedido entregado' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo marcar el pedido como entregado.')
    expect(source.listReadyOrders).toHaveBeenCalledTimes(2)
    expect(screen.getByText('M-4 · Ana')).toBeVisible()
  })

  it('reloads with Actualizar and polls on the interval until unmount', async () => {
    const source = makeSource()
    render(<DeliveryBoard source={source} />)
    await screen.findByText('M-4 · Ana')
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }))
    expect(source.listReadyOrders).toHaveBeenCalledTimes(2)
  })

  it('polls on the interval and stops on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const source = makeSource()
    const { unmount } = render(<DeliveryBoard source={source} pollIntervalMs={1000} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(source.listReadyOrders.mock.calls.length).toBeGreaterThanOrEqual(3)
    unmount()
    const calls = source.listReadyOrders.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(source.listReadyOrders).toHaveBeenCalledTimes(calls)
  })

  it('reloads when the realtime signal arrives and unsubscribes on unmount', async () => {
    const base = makeSource([[order()], [order(), order({ id: 'o2', tableNumber: 5, customerName: null })]])
    const { source, signal, unsubscribe } = withRealtime(base)
    const { unmount } = render(<DeliveryBoard source={source} />)
    await screen.findByText('M-4 · Ana')
    act(() => signal())
    expect(await screen.findByText('M-5')).toBeVisible()
    expect(base.listReadyOrders).toHaveBeenCalledTimes(2)
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('colours the card by how long the order has waited', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-01-01T15:30:00Z'))
    const orders = [
      order({ id: 'a', tableNumber: 1, customerName: null, createdAt: '2026-01-01T15:20:00Z' }),
      order({ id: 'b', tableNumber: 2, customerName: null, createdAt: '2026-01-01T15:10:00Z' }),
      order({ id: 'c', tableNumber: 3, customerName: null, createdAt: '2026-01-01T15:00:00Z' }),
    ]
    render(<DeliveryBoard source={makeSource([orders])} />)
    const card = async (label: string) => (await screen.findByText(label)).closest('li')!
    expect(await card('M-1')).toHaveAttribute('data-delay', 'ok')
    expect(await card('M-1')).toHaveClass('bg-white')
    expect(await card('M-2')).toHaveAttribute('data-delay', 'warning')
    expect(await card('M-2')).toHaveClass('bg-yellow-100')
    expect(await card('M-3')).toHaveAttribute('data-delay', 'late')
    expect(await card('M-3')).toHaveClass('bg-red-100')
  })
})
