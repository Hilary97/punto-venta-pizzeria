import type { PizzaConfig } from '../../pizza/domain/pizza'

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

/** Lines picked up in one place, labelled with the token colour used there. */
export interface PickupGroup {
  station: KitchenStation | null
  label: string
  lines: KitchenLine[]
}

/** Each kitchen leaves plates in its own pickup area with its own token colour. */
export const PICKUP_LABELS: Record<KitchenStation, string> = {
  pizza: 'Recoger en Pizzas (ficha roja)',
  grill: 'Recoger en Hamburguesas y botanas (ficha azul)',
}

const OTHER_PICKUP_LABEL = 'Bebidas y otros'

/** Groups delivery lines by pickup place: pizzas, then grill, then uncooked lines; empty groups are dropped. */
export function pickupGroups(lines: KitchenLine[]): PickupGroup[] {
  const groups: PickupGroup[] = [
    { station: 'pizza', label: PICKUP_LABELS.pizza, lines: [] },
    { station: 'grill', label: PICKUP_LABELS.grill, lines: [] },
    { station: null, label: OTHER_PICKUP_LABEL, lines: [] },
  ]
  for (const line of lines) {
    groups.find((group) => group.station === (line.station ?? null))!.lines.push(line)
  }
  return groups.filter((group) => group.lines.length > 0)
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

export interface KitchenSource {
  listOrders(): Promise<KitchenOrder[]>
  /** Marks ready only the given lines: the ones the card showed, never lines added since. */
  markReady(orderId: string, lineIds: string[]): Promise<string>
}

export interface DeliverySource {
  listReadyOrders(): Promise<KitchenOrder[]>
  /** Delivers only the given lines: the ones the card showed, never lines that became ready since. */
  markDelivered(orderId: string, lineIds: string[]): Promise<string>
}
