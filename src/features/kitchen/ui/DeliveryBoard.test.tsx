import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeliverySource, KitchenOrder } from '../domain/kitchen'
import { DeliveryBoard } from './DeliveryBoard'

function order(overrides: Partial<KitchenOrder> = {}): KitchenOrder {
  return {
    id: 'o1',
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

describe('DeliveryBoard', () => {
  beforeEach(() => vi.useRealTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the order card with every detail', async () => {
    render(<DeliveryBoard source={makeSource()} />)
    expect(await screen.findByText('M-4 · Ana')).toBeVisible()
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
})
