/** A line item in the in-progress sale cart. Price is a snapshot in cents. */
export interface CartItem {
  productId: string
  name: string
  unitPriceCents: number
  quantity: number
}

export type NewCartItem = Omit<CartItem, 'quantity'>

/** Adds a product to the cart, incrementing quantity if it is already present. */
export function addItemToCart(cart: CartItem[], product: NewCartItem): CartItem[] {
  const existing = cart.find((item) => item.productId === product.productId)
  if (existing) {
    return incrementItemInCart(cart, product.productId)
  }
  return [...cart, { ...product, quantity: 1 }]
}

/** Removes a product from the cart entirely, regardless of quantity. */
export function removeItemFromCart(cart: CartItem[], productId: string): CartItem[] {
  return cart.filter((item) => item.productId !== productId)
}

/** Increases the quantity of a cart line by one. */
export function incrementItemInCart(cart: CartItem[], productId: string): CartItem[] {
  return cart.map((item) =>
    item.productId === productId ? { ...item, quantity: item.quantity + 1 } : item,
  )
}

/**
 * Decreases the quantity of a cart line by one. Removes the line entirely
 * when the quantity would reach zero.
 */
export function decrementItemInCart(cart: CartItem[], productId: string): CartItem[] {
  return cart
    .map((item) => (item.productId === productId ? { ...item, quantity: item.quantity - 1 } : item))
    .filter((item) => item.quantity > 0)
}

/** Sum of unit price times quantity across all cart lines, in cents. */
export function cartTotalCents(cart: CartItem[]): number {
  return cart.reduce((total, item) => total + item.unitPriceCents * item.quantity, 0)
}

/** Sum of quantities across all cart lines. */
export function cartItemCount(cart: CartItem[]): number {
  return cart.reduce((total, item) => total + item.quantity, 0)
}
