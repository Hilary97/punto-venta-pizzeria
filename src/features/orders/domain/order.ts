export type OrderStatus = 'open' | 'paid' | 'cancelled'

/** A line of an order. Orders never store prices; they are resolved at payment. */
export interface OrderItem {
  id: string
  productId: string | null
  productName: string
  quantity: number
}

export interface Order {
  id: string
  tableNumber: number | null
  customerName: string | null
  status: OrderStatus
  createdAt: string
  waiterName: string | null
  items: OrderItem[]
}

export interface OrderItemPayload {
  productId: string
  quantity: number
}

export const TABLE_NUMBERS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]

export const MAX_CUSTOMER_NAME_LENGTH = 80

/** Display label for a table, e.g. `M-3`. */
export function tableLabel(tableNumber: number): string {
  return `M-${tableNumber}`
}

/** Trims the name and collapses any inner whitespace run into a single space. */
export function normalizeCustomerName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/** A customer name is valid when it has 1..80 characters after normalizing. */
export function isValidCustomerName(raw: string): boolean {
  const length = normalizeCustomerName(raw).length
  return length >= 1 && length <= MAX_CUSTOMER_NAME_LENGTH
}

/** Label for an order: `M-3 · Juan`, `M-3` or `Juan`, depending on what was registered. */
export function orderLabel(order: { tableNumber: number | null; customerName: string | null }): string {
  const parts: string[] = []
  if (order.tableNumber !== null) parts.push(tableLabel(order.tableNumber))
  if (order.customerName) parts.push(order.customerName)
  return parts.join(' · ')
}

/**
 * An order needs a table or a customer name. A name that is filled in must be
 * valid even when a table is selected.
 */
export function canRegisterOrder(tableNumber: number | null, rawName: string): boolean {
  if (normalizeCustomerName(rawName).length === 0) return tableNumber !== null
  return isValidCustomerName(rawName)
}
