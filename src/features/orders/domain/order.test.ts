import { describe, expect, it } from 'vitest'
import {
  canRegisterOrder,
  isValidCustomerName,
  MAX_CUSTOMER_NAME_LENGTH,
  normalizeCustomerName,
  orderLabel,
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

describe('orderLabel', () => {
  it('joins table and name', () => {
    expect(orderLabel({ tableNumber: 3, customerName: 'Juan' })).toBe('M-3 · Juan')
  })

  it('shows only the table when there is no name', () => {
    expect(orderLabel({ tableNumber: 3, customerName: null })).toBe('M-3')
  })

  it('shows only the name when there is no table', () => {
    expect(orderLabel({ tableNumber: null, customerName: 'Juan' })).toBe('Juan')
  })
})

describe('canRegisterOrder', () => {
  it('accepts a table alone', () => {
    expect(canRegisterOrder(3, '')).toBe(true)
    expect(canRegisterOrder(3, '   ')).toBe(true)
  })

  it('accepts a name alone', () => {
    expect(canRegisterOrder(null, ' Juan ')).toBe(true)
  })

  it('rejects neither table nor name', () => {
    expect(canRegisterOrder(null, '')).toBe(false)
    expect(canRegisterOrder(null, '   ')).toBe(false)
  })

  it('rejects an over-long name even with a table', () => {
    expect(canRegisterOrder(3, 'a'.repeat(MAX_CUSTOMER_NAME_LENGTH + 1))).toBe(false)
    expect(canRegisterOrder(null, 'a'.repeat(MAX_CUSTOMER_NAME_LENGTH + 1))).toBe(false)
  })
})
