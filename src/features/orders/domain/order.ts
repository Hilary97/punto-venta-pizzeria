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
  /** Kitchen station that cooks the line; `null` when it is not cooked or the source does not report it. */
  station?: 'pizza' | 'grill' | null
  /** When the kitchen finished the line (ISO); `null` while pending. */
  readyAt?: string | null
  /** When a waiter delivered the line (ISO); `null` until then. */
  deliveredAt?: string | null
}

export interface Order {
  id: string
  /** Physical token (ficha) 1..50 held by the order; `null` when none was free; omitted by sources without tokens. */
  token?: number | null
  tableNumber: number | null
  customerName: string | null
  status: OrderStatus
  createdAt: string
  waiterName: string | null
  notes: string | null
  /** Pickup time (ISO) of a scheduled order; `null` (or omitted) for ordinary orders. */
  scheduledFor?: string | null
  /** When the order entered the kitchen queue (ISO); `null` while a scheduled order waits. */
  queuedAt?: string | null
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

/** Label for an order's physical token, e.g. `Ficha 12`, or `Sin ficha` when it has none. */
export function tokenLabel(token: number | null): string {
  return token === null ? 'Sin ficha' : `Ficha ${token}`
}

/** A scheduled order that has not entered the kitchen queue yet (no token so far). */
export function isWaitingScheduled(order: Pick<Order, 'scheduledFor' | 'queuedAt'>): boolean {
  return order.scheduledFor != null && order.queuedAt == null
}

function parsePickupTime(hhmm: string): { hours: number; minutes: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? { hours, minutes } : null
}

/** Pickup time `HH:MM` as that time today on this device (ISO); `null` when blank or invalid. */
export function pickupTimeToIso(hhmm: string, now: Date): string | null {
  const time = parsePickupTime(hhmm)
  if (!time) return null
  const date = new Date(now)
  date.setHours(time.hours, time.minutes, 0, 0)
  return date.toISOString()
}

/** A pickup time must be a later minute today, as the server requires. */
export function isFuturePickupTime(hhmm: string, now: Date): boolean {
  const iso = pickupTimeToIso(hhmm, now)
  return iso !== null && Date.parse(iso) > now.getTime()
}

/** Label for a pickup time in 24-hour device time, e.g. `Para las 14:30`. */
export function pickupTimeLabel(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Para las ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const PICKUP_TIME_ERROR = 'La hora del pedido debe ser más tarde hoy.'

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
