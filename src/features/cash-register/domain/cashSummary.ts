export interface CashSummaryInput {
  openingCents: number
  salesTotalCents: number
  returnsTotalCents: number
  countedCents: number
}

export interface CashSummary {
  openingCents: number
  salesTotalCents: number
  returnsTotalCents: number
  expectedCents: number
  countedCents: number
  differenceCents: number
}

/**
 * Computes the end-of-shift cash summary (corte de caja):
 * expected = opening float + sales - returns
 * difference = counted - expected (positive = surplus, negative = shortage)
 */
export function computeCashSummary(input: CashSummaryInput): CashSummary {
  const expectedCents = input.openingCents + input.salesTotalCents - input.returnsTotalCents
  const differenceCents = input.countedCents - expectedCents

  return {
    openingCents: input.openingCents,
    salesTotalCents: input.salesTotalCents,
    returnsTotalCents: input.returnsTotalCents,
    expectedCents,
    countedCents: input.countedCents,
    differenceCents,
  }
}
