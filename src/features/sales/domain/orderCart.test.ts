import { describe, expect, it } from 'vitest'
import type { OrderItem } from '../../orders/domain/order'
import type { Product } from '../../products/domain/product'
import { buildOrderCart } from './orderCart'

const products: Product[] = [
  { id: 'p', categoryId: 'c', name: 'Pizza queso', priceCents: 15000, active: true },
  { id: 'd', categoryId: 'c', name: 'Agua', priceCents: 2000, active: true },
]

function item(productId: string | null, quantity: number, productName = 'Snapshot'): OrderItem {
  return { id: `${productId}-${quantity}`, productId, productName, quantity, type: 'product', pizza: null, notes: null }
}

describe('buildOrderCart', () => {
  it('maps order items to cart lines using current product prices and names', () => {
    const result = buildOrderCart([item('p', 2, 'Old name'), item('d', 1)], products)
    expect(result.items).toEqual([
      { productId: 'p', name: 'Pizza queso', unitPriceCents: 15000, quantity: 2 },
      { productId: 'd', name: 'Agua', unitPriceCents: 2000, quantity: 1 },
    ])
    expect(result.unavailable).toEqual([])
  })

  it('reports items whose product is missing or inactive and leaves them out of the cart', () => {
    const result = buildOrderCart([item('p', 1), item('gone', 1, 'Calzone'), item(null, 3, 'Borrado')], products)
    expect(result.items).toEqual([{ productId: 'p', name: 'Pizza queso', unitPriceCents: 15000, quantity: 1 }])
    expect(result.unavailable).toEqual(['Calzone', 'Borrado'])
  })

  it('merges repeated products by summing quantities', () => {
    const result = buildOrderCart([item('d', 1), item('d', 2)], products)
    expect(result.items).toEqual([{ productId: 'd', name: 'Agua', unitPriceCents: 2000, quantity: 3 }])
  })
})
