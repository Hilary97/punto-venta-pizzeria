import type { Category, Product } from '../../products/domain/product'
import type { Order, OrderItemPayload } from './order'

/** Device catalogs carry no prices: products come with `priceCents: 0` and are shown without prices. */
export interface OrdersCatalog {
  categories: Category[]
  products: Product[]
}

/** Where the orders workspace reads and writes: a signed-in session or an authorized device. */
export interface OrdersSource {
  loadCatalog(): Promise<OrdersCatalog>
  listOpenOrders(): Promise<Order[]>
  createOrder(tableNumber: number | null, customerName: string | null, items: OrderItemPayload[]): Promise<string>
  addOrderItems(orderId: string, items: OrderItemPayload[]): Promise<string>
  cancelOrder(orderId: string): Promise<string>
}
