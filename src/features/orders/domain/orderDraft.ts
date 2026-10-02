import type { OrderItemPayload } from './order'

/** A line in the order being composed on the waiter screen. Deliberately price-less. */
export interface DraftLine {
  productId: string
  name: string
  quantity: number
}

export type NewDraftLine = Omit<DraftLine, 'quantity'>

/** Adds a product to the draft, incrementing quantity if it is already present. */
export function addToDraft(draft: DraftLine[], product: NewDraftLine): DraftLine[] {
  const existing = draft.find((line) => line.productId === product.productId)
  if (existing) {
    return incrementDraftLine(draft, product.productId)
  }
  return [...draft, { ...product, quantity: 1 }]
}

/** Increases the quantity of a draft line by one. */
export function incrementDraftLine(draft: DraftLine[], productId: string): DraftLine[] {
  return draft.map((line) =>
    line.productId === productId ? { ...line, quantity: line.quantity + 1 } : line,
  )
}

/** Decreases a draft line by one, removing it when the quantity would reach zero. */
export function decrementDraftLine(draft: DraftLine[], productId: string): DraftLine[] {
  return draft
    .map((line) => (line.productId === productId ? { ...line, quantity: line.quantity - 1 } : line))
    .filter((line) => line.quantity > 0)
}

/** Removes a product from the draft entirely, regardless of quantity. */
export function removeDraftLine(draft: DraftLine[], productId: string): DraftLine[] {
  return draft.filter((line) => line.productId !== productId)
}

/** Sum of quantities across all draft lines. */
export function draftItemCount(draft: DraftLine[]): number {
  return draft.reduce((total, line) => total + line.quantity, 0)
}

/** Maps the draft to the payload sent to the server (ids and quantities only). */
export function draftToPayload(draft: DraftLine[]): OrderItemPayload[] {
  return draft.map((line) => ({ productId: line.productId, quantity: line.quantity }))
}
