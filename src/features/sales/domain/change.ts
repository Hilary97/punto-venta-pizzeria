/** Thrown when the cash received from the customer is less than the sale total. */
export class InsufficientPaymentError extends Error {
  constructor() {
    super('El monto recibido es menor al total de la venta.')
    this.name = 'InsufficientPaymentError'
  }
}

/** Computes change in cents, rejecting a payment that does not cover the total. */
export function calculateChangeCents(totalCents: number, receivedCents: number): number {
  if (receivedCents < totalCents) {
    throw new InsufficientPaymentError()
  }
  return receivedCents - totalCents
}
