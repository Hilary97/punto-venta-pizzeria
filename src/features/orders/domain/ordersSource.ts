import type { Category, Product } from '../../products/domain/product'
import type { PizzaCatalog, PizzaConfig } from '../../pizza/domain/pizza'
import type { SubscribeChanges } from '../../../shared/realtime/useChangeSignal'
import type { Order, OrderItemPayload, OrderService } from './order'

/** Device catalogs carry no prices: products come with `priceCents: 0` and are shown without prices. */
export interface OrdersCatalog {
  categories: Category[]
  products: Product[]
  pizza: PizzaCatalog
}

export interface CreateOrderInput {
  tableNumber: number | null
  customerName: string | null
  items: OrderItemPayload[]
  notes: string | null
  /** Pickup time (ISO, today) of a scheduled order; `null` for ordinary orders. */
  scheduledFor: string | null
  service: OrderService
}

/** One "Más vendidas" shortcut: a pizza configuration or a product (with its variant). */
export type PopularPick =
  | { kind: 'pizza'; pizza: PizzaConfig }
  | { kind: 'product'; productId: string; variant: string | null }

/** Where the orders workspace reads and writes: a signed-in session or an authorized device. */
export interface OrdersSource {
  loadCatalog(): Promise<OrdersCatalog>
  /** Fixed pizzas, then best-selling pizzas and products ("Más vendidas"); optional, failures are not shown. */
  loadPopularPicks?(): Promise<PopularPick[]>
  /**
   * Admin-managed note shortcuts in order: for pizza notes, the order note and, by category id, the product line
   * notes; optional, failures are not shown.
   */
  loadNoteShortcuts?(): Promise<{ pizza: string[]; order: string[]; categories: Record<string, string[]> }>
  listOpenOrders(): Promise<Order[]>
  createOrder(input: CreateOrderInput): Promise<string>
  addOrderItems(orderId: string, items: OrderItemPayload[]): Promise<string>
  cancelOrder(orderId: string): Promise<string>
  setOrderNotes(orderId: string, notes: string | null): Promise<string>
  /** Realtime signal that open orders changed (e.g. another waiter added items). */
  subscribe?: SubscribeChanges
}
