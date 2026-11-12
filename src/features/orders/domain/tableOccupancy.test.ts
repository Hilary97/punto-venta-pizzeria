import { describe, expect, it } from 'vitest'
import type { Order } from './order'
import { tableOccupancy } from './tableOccupancy'

const now = new Date(2026, 9, 21, 12, 0)
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString()

const base: Order = {
  id: 'o1',
  token: 3,
  tableNumber: 6,
  customerName: null,
  status: 'open',
  createdAt: minutesAgo(22),
  waiterName: 'Lucía',
  notes: null,
  items: [{ id: 'i', productId: 'p', productName: 'X', quantity: 1, type: 'product', pizza: null, notes: null, variant: null }],
}

describe('tableOccupancy', () => {
  it('maps only tables with an open order and describes ficha, waiter and minutes', () => {
    const map = tableOccupancy([base, { ...base, id: 'o2', tableNumber: null }], now)
    expect([...map.keys()]).toEqual([6])
    expect(map.get(6)).toMatchObject({ order: base, detail: 'Ficha 3 · 22 min · Lucía', statusKind: 'open' })
  })

  it('leaves out missing waiter and token data, and never shows negative minutes', () => {
    const map = tableOccupancy([{ ...base, waiterName: null, token: undefined, createdAt: minutesAgo(-5) }], now)
    expect(map.get(6)!.detail).toBe('0 min')
    expect(tableOccupancy([{ ...base, token: null }], now).get(6)!.detail).toBe('Sin ficha · 22 min · Lucía')
  })

  it('reports a scheduled order with its pickup time', () => {
    const scheduledFor = new Date(2026, 9, 21, 14, 30).toISOString()
    const waiting = tableOccupancy([{ ...base, token: null, scheduledFor, queuedAt: null }], now).get(6)!
    expect(waiting.statusKind).toBe('scheduled')
    expect(waiting.statusLabel).toBe('Programado 2:30 p.m.')
    const queued = tableOccupancy([{ ...base, scheduledFor, queuedAt: minutesAgo(1) }], now).get(6)!
    expect(queued.statusLabel).toBe('Programado 2:30 p.m.')
  })

  it('reports Entregado when every line was delivered, and Abierto otherwise', () => {
    const delivered = { ...base, items: [{ ...base.items[0]!, deliveredAt: minutesAgo(1) }] }
    expect(tableOccupancy([delivered], now).get(6)).toMatchObject({ statusKind: 'delivered', statusLabel: 'Entregado' })
    expect(tableOccupancy([base], now).get(6)).toMatchObject({ statusKind: 'open', statusLabel: 'Abierto' })
  })

  it('keeps the oldest order when a table somehow has several', () => {
    const older = { ...base, id: 'old', createdAt: minutesAgo(40) }
    expect(tableOccupancy([base, older], now).get(6)!.order.id).toBe('old')
  })
})
