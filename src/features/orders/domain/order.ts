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
  tableNumber: number
  customerName: string
  status: OrderStatus
  createdAt: string
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
