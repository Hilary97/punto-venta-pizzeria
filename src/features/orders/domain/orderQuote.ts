export interface QuoteLine {
  orderItemId: string
  itemType: 'product' | 'pizza'
  name: string
  notes: string | null
  quantity: number
  /** `null` when the line is unavailable (see `reason`). */
  unitPriceCents: number | null
  lineTotalCents: number | null
  available: boolean
  reason: string | null
}

/** Server-side pricing of an order at current catalog prices. */
export interface OrderQuote {
  orderId: string
  status: 'open' | 'paid' | 'cancelled'
  lines: QuoteLine[]
  totalCents: number
  /** True only for open orders whose lines are all available. */
  payable: boolean
}
