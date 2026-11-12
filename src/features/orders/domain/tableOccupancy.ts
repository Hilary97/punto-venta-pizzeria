import { isFullyDelivered, pickupClockLabel, tokenLabel, type Order } from './order'

export type OccupancyStatusKind = 'scheduled' | 'delivered' | 'open'

/** What the table map shows for a table that has an open order. */
export interface TableOccupancy {
  order: Order
  /** `Ficha 3 · 22 min · Lucía`, leaving out whatever the order does not report. */
  detail: string
  statusKind: OccupancyStatusKind
  statusLabel: string
}

function describe(order: Order, now: Date): TableOccupancy {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(order.createdAt)) / 60_000))
  const parts: string[] = []
  if (order.token !== undefined) parts.push(tokenLabel(order.token))
  parts.push(`${minutes} min`)
  if (order.waiterName) parts.push(order.waiterName)
  const detail = parts.join(' · ')

  if (isFullyDelivered(order)) return { order, detail, statusKind: 'delivered', statusLabel: 'Entregado' }
  if (order.scheduledFor) {
    return { order, detail, statusKind: 'scheduled', statusLabel: `Programado ${pickupClockLabel(order.scheduledFor)}` }
  }
  return { order, detail, statusKind: 'open', statusLabel: 'Abierto' }
}

/** Occupancy per table number from the open orders; the server allows one open order per table. */
export function tableOccupancy(orders: Order[], now: Date): Map<number, TableOccupancy> {
  const byTable = new Map<number, Order>()
  for (const order of orders) {
    if (order.tableNumber === null) continue
    const current = byTable.get(order.tableNumber)
    if (!current || order.createdAt < current.createdAt) byTable.set(order.tableNumber, order)
  }
  return new Map([...byTable].map(([table, order]) => [table, describe(order, now)]))
}
