import { describe, expect, it } from 'vitest'
import { calculateChangeCents, InsufficientPaymentError } from './change'

describe('calculateChangeCents', () => {
  it('returns the difference between received and total', () => {
    expect(calculateChangeCents(10000, 20000)).toBe(10000)
  })

  it('returns 0 when the exact amount is received', () => {
    expect(calculateChangeCents(15050, 15050)).toBe(0)
  })

  it('throws InsufficientPaymentError when received is less than total', () => {
    expect(() => calculateChangeCents(15000, 10000)).toThrow(InsufficientPaymentError)
  })
})
