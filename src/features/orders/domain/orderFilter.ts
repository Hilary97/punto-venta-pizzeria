import { compareNames } from '../../../shared/sortByName'
import type { Order } from './order'

export interface OrderFilter {
  tableNumber: number | null
  nameQuery: string
}

/** Lowercases and strips accents so `José` and `jose` compare equal. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Filters orders by table and/or customer name (AND), preserving order. */
export function filterOrders(orders: Order[], filter: OrderFilter): Order[] {
  const query = fold(filter.nameQuery.trim())
  return orders.filter((order) => {
    if (filter.tableNumber !== null && order.tableNumber !== filter.tableNumber) return false
    if (query === '') return true
    return order.customerName !== null && fold(order.customerName).includes(query)
  })
}

/**
 * Orders by customer name A-Z; orders without a name go last, by table number.
 * Ties keep the oldest first. Returns a new array.
 */
export function sortOrdersByName(orders: Order[]): Order[] {
  return [...orders].sort((a, b) => {
    if (a.customerName && b.customerName) {
      const byCustomer = compareNames(a.customerName, b.customerName)
      if (byCustomer !== 0) return byCustomer
    } else if (a.customerName || b.customerName) {
      return a.customerName ? -1 : 1
    }
    const tableA = a.tableNumber ?? Number.POSITIVE_INFINITY
    const tableB = b.tableNumber ?? Number.POSITIVE_INFINITY
    if (tableA !== tableB) return tableA < tableB ? -1 : 1
    return a.createdAt.localeCompare(b.createdAt)
  })
}
