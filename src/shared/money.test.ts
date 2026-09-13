import { describe, expect, it } from 'vitest'
import { formatMoney, parseMoneyInput } from './money'

describe('formatMoney', () => {
  it('formats whole pesos with two decimals and currency symbol', () => {
    expect(formatMoney(15000)).toBe('$150.00')
  })

  it('formats cents correctly', () => {
    expect(formatMoney(15050)).toBe('$150.50')
  })

  it('formats zero', () => {
    expect(formatMoney(0)).toBe('$0.00')
  })

  it('formats single-digit cents with leading zero', () => {
    expect(formatMoney(105)).toBe('$1.05')
  })

  it('formats negative amounts with a leading minus sign', () => {
    expect(formatMoney(-500)).toBe('-$5.00')
  })
})

describe('parseMoneyInput', () => {
  it('parses a plain integer as pesos into cents', () => {
    expect(parseMoneyInput('150')).toBe(15000)
  })

  it('parses a decimal value into cents', () => {
    expect(parseMoneyInput('150.50')).toBe(15050)
  })

  it('parses a value with a single decimal digit', () => {
    expect(parseMoneyInput('150.5')).toBe(15050)
  })

  it('rounds fractional cents to the nearest cent', () => {
    expect(parseMoneyInput('150.505')).toBe(15051)
  })

  it('rejects a comma used as a decimal separator', () => {
    expect(parseMoneyInput('150,50')).toBeNull()
  })

  it('parses a value with a thousands separator', () => {
    expect(parseMoneyInput('1,850')).toBe(185000)
  })

  it('parses a value with a thousands separator and decimals', () => {
    expect(parseMoneyInput('12,345.50')).toBe(1234550)
  })

  it('parses a value with a thousands separator and a currency symbol', () => {
    expect(parseMoneyInput('$1,850.00')).toBe(185000)
  })

  it('returns null for an incomplete thousands group', () => {
    expect(parseMoneyInput('1,85')).toBeNull()
  })

  it('returns null when the group after the comma is not 3 digits', () => {
    expect(parseMoneyInput('18,50')).toBeNull()
  })

  it('returns null when the group after the comma has too many digits', () => {
    expect(parseMoneyInput('1,8500')).toBeNull()
  })

  it('returns null for a leading comma', () => {
    expect(parseMoneyInput(',5')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(parseMoneyInput('')).toBeNull()
  })

  it('returns null for non-numeric input', () => {
    expect(parseMoneyInput('abc')).toBeNull()
  })

  it('returns null for negative input', () => {
    expect(parseMoneyInput('-10')).toBeNull()
  })

  it('trims whitespace and currency symbols', () => {
    expect(parseMoneyInput(' $150.50 ')).toBe(15050)
  })
})
