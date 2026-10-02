import { describe, expect, it } from 'vitest'
import {
  isValidCustomerName,
  MAX_CUSTOMER_NAME_LENGTH,
  normalizeCustomerName,
  TABLE_NUMBERS,
  tableLabel,
} from './order'

describe('TABLE_NUMBERS', () => {
  it('lists tables 1 through 9', () => {
    expect(TABLE_NUMBERS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})

describe('tableLabel', () => {
  it('prefixes the table number with M-', () => {
    expect(tableLabel(3)).toBe('M-3')
  })
})

describe('normalizeCustomerName', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeCustomerName('  Ana  ')).toBe('Ana')
  })

  it('collapses inner whitespace', () => {
    expect(normalizeCustomerName('Ana \t  María\n López')).toBe('Ana María López')
  })
})

describe('isValidCustomerName', () => {
  it('accepts a regular name', () => {
    expect(isValidCustomerName('Ana')).toBe(true)
  })

  it('rejects empty and whitespace-only names', () => {
    expect(isValidCustomerName('')).toBe(false)
    expect(isValidCustomerName('   ')).toBe(false)
  })

  it('accepts exactly the maximum length after normalizing', () => {
    expect(isValidCustomerName(`  ${'a'.repeat(MAX_CUSTOMER_NAME_LENGTH)}  `)).toBe(true)
  })

  it('rejects names longer than the maximum', () => {
    expect(isValidCustomerName('a'.repeat(MAX_CUSTOMER_NAME_LENGTH + 1))).toBe(false)
  })

  it('measures length after collapsing inner whitespace', () => {
    expect(isValidCustomerName(`${'a'.repeat(79)}   b`)).toBe(false)
    expect(isValidCustomerName(`${'a'.repeat(38)}     ${'b'.repeat(38)}`)).toBe(true)
  })
})
