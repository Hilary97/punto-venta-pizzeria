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
}

/** An open order seen by a station (only its pending lines) or by delivery (lines still to deliver). */
export interface KitchenOrder {
  id: string
  tableNumber: number | null
  customerName: string | null
  waiterName: string | null
  notes: string | null
  createdAt: string
  lines: KitchenLine[]
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
