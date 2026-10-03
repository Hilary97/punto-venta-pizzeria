import type { PizzaConfig } from '../../pizza/domain/pizza'

export type OrderStatus = 'open' | 'paid' | 'cancelled'

/** A line of an order. Orders never store prices; they are resolved at payment. */
export interface OrderItem {
  id: string
  productId: string | null
  productName: string
  quantity: number
  type: 'product' | 'pizza'
  /** Canonical configuration for pizza lines; `null` for products. */
  pizza: PizzaConfig | null
  notes: string | null
  /** Chosen variant for product lines of products with variants; otherwise `null`. */
  variant: string | null
}

export interface Order {
  id: string
  tableNumber: number | null
  customerName: string | null
  status: OrderStatus
  createdAt: string
  waiterName: string | null
  notes: string | null
  items: OrderItem[]
}

export type OrderItemPayload =
  | { type: 'product'; productId: string; quantity: number; notes?: string | null; variant?: string | null }
  | { type: 'pizza'; pizza: PizzaConfig; quantity: number; notes?: string | null }

export const TABLE_NUMBERS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]

export const MAX_CUSTOMER_NAME_LENGTH = 80

export const MAX_ORDER_NOTES_LENGTH = 300

export const MAX_ITEM_NOTES_LENGTH = 200

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

/** Display label for a product line: `Name (Variant)` or just the name. */
export function productLineLabel(name: string, variant: string | null): string {
  return variant === null ? name : `${name} (${variant})`
}

/** Trims a note; blank or missing becomes `null`, as the server stores it. */
export function normalizeNotes(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}
