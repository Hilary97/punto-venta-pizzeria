import { describe, expect, it } from 'vitest'
import { computeCashSummary } from './cashSummary'

describe('computeCashSummary', () => {
  it('computes expected cash as opening + sales - returns', () => {
    const summary = computeCashSummary({
      openingCents: 50000,
      salesTotalCents: 120000,
      returnsTotalCents: 20000,
      countedCents: 150000,
    })
    expect(summary.expectedCents).toBe(150000)
  })

  it('computes difference as counted - expected', () => {
    const summary = computeCashSummary({
      openingCents: 50000,
      salesTotalCents: 120000,
      returnsTotalCents: 20000,
      countedCents: 150000,
    })
    expect(summary.differenceCents).toBe(0)
  })

  it('reports a negative difference when counted cash is short', () => {
    const summary = computeCashSummary({
      openingCents: 50000,
      salesTotalCents: 100000,
      returnsTotalCents: 0,
      countedCents: 140000,
    })
    expect(summary.differenceCents).toBe(-10000)
  })

  it('reports a positive difference when counted cash is over', () => {
    const summary = computeCashSummary({
      openingCents: 50000,
      salesTotalCents: 100000,
      returnsTotalCents: 0,
      countedCents: 160000,
    })
    expect(summary.differenceCents).toBe(10000)
  })
})
