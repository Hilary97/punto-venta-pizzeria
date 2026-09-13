import { describe, expect, it } from 'vitest'
import { calculateReturnableQuantity, InvalidReturnQuantityError, validateReturnQuantity } from './returnable'

describe('calculateReturnableQuantity', () => {
  it('returns the difference between sold and already returned', () => {
    expect(calculateReturnableQuantity(5, 2)).toBe(3)
  })

  it('returns 0 when everything sold has already been returned', () => {
    expect(calculateReturnableQuantity(3, 3)).toBe(0)
  })

  it('never returns a negative number', () => {
    expect(calculateReturnableQuantity(2, 5)).toBe(0)
  })
})

describe('validateReturnQuantity', () => {
  it('accepts a quantity within the returnable amount', () => {
    expect(() => validateReturnQuantity(2, 3)).not.toThrow()
  })

  it('accepts a quantity equal to the returnable amount', () => {
    expect(() => validateReturnQuantity(3, 3)).not.toThrow()
  })

  it('rejects a quantity above the returnable amount', () => {
    expect(() => validateReturnQuantity(4, 3)).toThrow(InvalidReturnQuantityError)
  })

  it('rejects a zero or negative quantity', () => {
    expect(() => validateReturnQuantity(0, 3)).toThrow(InvalidReturnQuantityError)
  })
})
