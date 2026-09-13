/** Thrown when a requested return quantity is invalid for the sold/returned history. */
export class InvalidReturnQuantityError extends Error {
  constructor() {
    super('La cantidad a devolver no es válida.')
    this.name = 'InvalidReturnQuantityError'
  }
}

/** How many units of a sale item can still be returned. Never negative. */
export function calculateReturnableQuantity(soldQuantity: number, alreadyReturnedQuantity: number): number {
  return Math.max(0, soldQuantity - alreadyReturnedQuantity)
}

/** Validates a requested return quantity against what is still returnable. */
export function validateReturnQuantity(requestedQuantity: number, returnableQuantity: number): void {
  if (requestedQuantity <= 0 || requestedQuantity > returnableQuantity) {
    throw new InvalidReturnQuantityError()
  }
}
