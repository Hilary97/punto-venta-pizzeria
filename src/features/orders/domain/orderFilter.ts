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
