import type { PizzaConfig } from '../../pizza/domain/pizza'
import type { SubscribeChanges } from '../../../shared/realtime/useChangeSignal'

export type KitchenStation = 'pizza' | 'grill'

export type DeviceKind = 'waiter' | 'kitchen_pizza' | 'kitchen_grill'

export const DEVICE_KINDS: readonly DeviceKind[] = ['waiter', 'kitchen_pizza', 'kitchen_grill']

export const STATION_LABELS: Record<KitchenStation, string> = {
  pizza: 'Pizzas',
  grill: 'Hamburguesas y botanas',
}

/** The station a kitchen device works; `null` for waiter devices. */
export function deviceKindStation(kind: DeviceKind): KitchenStation | null {
  if (kind === 'kitchen_pizza') return 'pizza'
  if (kind === 'kitchen_grill') return 'grill'
  return null
}

export interface KitchenLine {
  id: string
  productName: string
  quantity: number
  type: 'product' | 'pizza'
  pizza: PizzaConfig | null
  notes: string | null
  variant: string | null
  /** Kitchen station that cooked the line; `null` (or omitted) when it is not cooked. */
  station?: KitchenStation | null
}

/**
 * An open order seen by a station or by delivery. A station sees one ticket per arrival batch
 * (`createdAt` is when those lines arrived), so one order may appear twice; delivery sees one per order.
 */
export interface KitchenOrder {
  id: string
  /** Physical token (ficha) 1..50 held by the order; `null` when none was free. */
  token: number | null
  tableNumber: number | null
  customerName: string | null
  waiterName: string | null
  notes: string | null
  createdAt: string
  lines: KitchenLine[]
}

/** Identifies a ticket on a board: the order plus its arrival time. */
export function ticketKey(order: Pick<KitchenOrder, 'id' | 'createdAt'>): string {
  return `${order.id}@${order.createdAt}`
}

/** How long a ticket has waited: `warning` (yellow) from 15 minutes, `late` (red) from 25. */
export type DelayLevel = 'ok' | 'warning' | 'late'

const WARNING_AFTER_MS = 15 * 60_000
const LATE_AFTER_MS = 25 * 60_000

export function delayLevel(createdAt: string, now: Date): DelayLevel {
  const waited = now.getTime() - Date.parse(createdAt)
  if (Number.isNaN(waited) || waited < WARNING_AFTER_MS) return 'ok'
  return waited < LATE_AFTER_MS ? 'warning' : 'late'
}

export type { SubscribeChanges } from '../../../shared/realtime/useChangeSignal'

export interface KitchenSource {
  listOrders(): Promise<KitchenOrder[]>
  /** Marks ready only the given lines: the ones the card showed, never lines added since. */
  markReady(orderId: string, lineIds: string[]): Promise<string>
  /** Realtime change signal; without it the board polls more often. */
  subscribe?: SubscribeChanges
}

export interface DeliverySource {
  listReadyOrders(): Promise<KitchenOrder[]>
  /** Delivers only the given lines: the ones the card showed, never lines that became ready since. */
  markDelivered(orderId: string, lineIds: string[]): Promise<string>
  /** Realtime change signal; without it the board polls more often. */
  subscribe?: SubscribeChanges
}
