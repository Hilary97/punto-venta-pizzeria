import { describe, expect, it } from 'vitest'
import {
  isShiftExpired,
  isValidPin,
  isValidWaiterName,
  MAX_WAITER_NAME_LENGTH,
  normalizeWaiterName,
  PIN_LENGTH,
  type WaiterShift,
} from './waiter'

const shift: WaiterShift = {
  token: 't',
  waiterId: 'w',
  fullName: 'Ana',
  expiresAt: '2026-10-03T12:00:00.000Z',
}

describe('isValidPin', () => {
  it('uses a 4 digit length', () => {
    expect(PIN_LENGTH).toBe(4)
  })

  it('accepts exactly 4 digits', () => {
    expect(isValidPin('0123')).toBe(true)
  })

  it('rejects wrong lengths and non-digits', () => {
    expect(isValidPin('123')).toBe(false)
    expect(isValidPin('12345')).toBe(false)
    expect(isValidPin('12a4')).toBe(false)
    expect(isValidPin('12 4')).toBe(false)
    expect(isValidPin('')).toBe(false)
  })
})

describe('normalizeWaiterName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeWaiterName('  Ana \t  María ')).toBe('Ana María')
  })
})

describe('isValidWaiterName', () => {
  it('accepts 1..60 characters after normalizing', () => {
    expect(isValidWaiterName('Ana')).toBe(true)
    expect(isValidWaiterName(` ${'a'.repeat(MAX_WAITER_NAME_LENGTH)} `)).toBe(true)
  })

  it('rejects empty and too long names', () => {
    expect(isValidWaiterName('   ')).toBe(false)
    expect(isValidWaiterName('a'.repeat(MAX_WAITER_NAME_LENGTH + 1))).toBe(false)
  })
})

describe('isShiftExpired', () => {
  it('is false before expiry', () => {
    expect(isShiftExpired(shift, new Date('2026-10-03T11:59:59.000Z'))).toBe(false)
  })

  it('is true at and after expiry', () => {
    expect(isShiftExpired(shift, new Date('2026-10-03T12:00:00.000Z'))).toBe(true)
    expect(isShiftExpired(shift, new Date('2026-10-04T00:00:00.000Z'))).toBe(true)
  })

  it('treats an unparseable date as expired', () => {
    expect(isShiftExpired({ ...shift, expiresAt: 'nope' })).toBe(true)
  })
})
