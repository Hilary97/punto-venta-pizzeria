import { describe, expect, it } from 'vitest'
import {
  addItemToCart,
  cartTotalCents,
  decrementItemInCart,
  incrementItemInCart,
  removeItemFromCart,
} from './cart'
import type { CartItem } from './cart'

const pizza: CartItem = {
  productId: 'p1',
  name: 'Pizza Margarita',
  unitPriceCents: 12000,
  quantity: 1,
}

const soda: CartItem = {
  productId: 'p2',
  name: 'Refresco',
  unitPriceCents: 2500,
  quantity: 1,
}

describe('addItemToCart', () => {
  it('adds a new product with quantity 1', () => {
    const cart = addItemToCart([], { productId: 'p1', name: 'Pizza Margarita', unitPriceCents: 12000 })
    expect(cart).toEqual([pizza])
  })

  it('increments quantity when the product already exists', () => {
    const cart = addItemToCart([pizza], { productId: 'p1', name: 'Pizza Margarita', unitPriceCents: 12000 })
    expect(cart).toEqual([{ ...pizza, quantity: 2 }])
  })
})

describe('removeItemFromCart', () => {
  it('removes the product regardless of quantity', () => {
    const cart = removeItemFromCart([pizza, soda], 'p1')
    expect(cart).toEqual([soda])
  })
})

describe('incrementItemInCart', () => {
  it('increases quantity by one', () => {
    const cart = incrementItemInCart([pizza], 'p1')
    expect(cart[0]?.quantity).toBe(2)
  })
})

describe('decrementItemInCart', () => {
  it('decreases quantity by one', () => {
    const cart = decrementItemInCart([{ ...pizza, quantity: 2 }], 'p1')
    expect(cart[0]?.quantity).toBe(1)
  })

  it('removes the item entirely when quantity reaches zero', () => {
    const cart = decrementItemInCart([pizza], 'p1')
    expect(cart).toEqual([])
  })
})

describe('cartTotalCents', () => {
  it('sums unit price times quantity across all items', () => {
    const total = cartTotalCents([pizza, { ...soda, quantity: 2 }])
    expect(total).toBe(12000 + 2500 * 2)
  })

  it('returns 0 for an empty cart', () => {
    expect(cartTotalCents([])).toBe(0)
  })
})
