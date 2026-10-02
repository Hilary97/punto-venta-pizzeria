import type { OrderItem } from '../../orders/domain/order'
import type { Product } from '../../products/domain/product'
import type { CartItem } from './cart'

export interface OrderCart {
  items: CartItem[]
  /** Snapshot names of order items whose product is missing or inactive. */
  unavailable: string[]
}

/**
 * Builds a display cart from order items using current active product prices.
 * Items without an active product are reported in `unavailable`; the server
 * still recomputes the real total at payment.
 */
export function buildOrderCart(orderItems: OrderItem[], activeProducts: Product[]): OrderCart {
  const byId = new Map(activeProducts.filter((product) => product.active).map((product) => [product.id, product]))
  const items: CartItem[] = []
  const unavailable: string[] = []

  for (const orderItem of orderItems) {
    const product = orderItem.productId === null ? undefined : byId.get(orderItem.productId)
    if (!product) {
      unavailable.push(orderItem.productName)
      continue
    }
    const existing = items.find((line) => line.productId === product.id)
    if (existing) {
      existing.quantity += orderItem.quantity
    } else {
      items.push({ productId: product.id, name: product.name, unitPriceCents: product.priceCents, quantity: orderItem.quantity })
    }
  }

  return { items, unavailable }
}
