import { describe, expect, it } from 'vitest'
import {
  canRegisterOrder,
  isFuturePickupTime,
  isValidCustomerName,
  MAX_CUSTOMER_NAME_LENGTH,
  MAX_ITEM_NOTES_LENGTH,
  MAX_ORDER_NOTES_LENGTH,
  normalizeCustomerName,
  normalizeNotes,
  MISSING_LABEL,
  missingForOrder,
  orderLabel,
  pickupClockLabel,
  pickupTimeLabel,
  pickupTimeToIso,
  productLineLabel,
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

describe('normalizeNotes', () => {
  it('trims the note', () => {
    expect(normalizeNotes('  sin cebolla  ')).toBe('sin cebolla')
  })

  it('turns blank or missing notes into null', () => {
    expect(normalizeNotes('   ')).toBeNull()
    expect(normalizeNotes('')).toBeNull()
    expect(normalizeNotes(null)).toBeNull()
    expect(normalizeNotes(undefined)).toBeNull()
  })

  it('exposes the SQL length limits', () => {
    expect(MAX_ORDER_NOTES_LENGTH).toBe(300)
    expect(MAX_ITEM_NOTES_LENGTH).toBe(200)
  })
})

describe('productLineLabel', () => {
  it('appends the variant in parentheses', () => {
    expect(productLineLabel('Monster', 'Pollo')).toBe('Monster (Pollo)')
  })

  it('returns the name alone without a variant', () => {
    expect(productLineLabel('Monster', null)).toBe('Monster')
  })
})

describe('pickup time', () => {
  const now = new Date(2026, 9, 21, 12, 0, 30)

  it('turns HH:MM into that time today on this device, null when blank', () => {
    expect(pickupTimeToIso('14:30', now)).toBe(new Date(2026, 9, 21, 14, 30).toISOString())
    expect(pickupTimeToIso('', now)).toBeNull()
    expect(pickupTimeToIso('   ', now)).toBeNull()
  })

  it('accepts only a later minute today', () => {
    expect(isFuturePickupTime('12:01', now)).toBe(true)
    expect(isFuturePickupTime('23:59', now)).toBe(true)
    expect(isFuturePickupTime('12:00', now)).toBe(false)
    expect(isFuturePickupTime('09:15', now)).toBe(false)
    expect(isFuturePickupTime('25:00', now)).toBe(false)
    expect(isFuturePickupTime('ab', now)).toBe(false)
  })

  it('labels the time in 12-hour format', () => {
    expect(pickupTimeLabel(new Date(2026, 9, 21, 14, 5).toISOString())).toBe('Para las 2:05 p.m.')
    expect(pickupTimeLabel(new Date(2026, 9, 21, 9, 30).toISOString())).toBe('Para las 9:30 a.m.')
    expect(pickupTimeLabel(new Date(2026, 9, 21, 12, 0).toISOString())).toBe('Para las 12:00 p.m.')
    expect(pickupTimeLabel(new Date(2026, 9, 21, 0, 15).toISOString())).toBe('Para las 12:15 a.m.')
  })
})

describe('pickupClockLabel', () => {
  it('shows the clock time without the "Para las" prefix', () => {
    expect(pickupClockLabel(new Date(2026, 9, 21, 14, 30).toISOString())).toBe('2:30 p.m.')
    expect(pickupClockLabel(new Date(2026, 9, 21, 0, 5).toISOString())).toBe('12:05 a.m.')
  })
})

describe('missingForOrder', () => {
  const ready = { itemCount: 2, adding: false, service: 'dine_in' as const, tableNumber: 4, customerName: '' }

  it('is empty when the order can be sent', () => {
    expect(missingForOrder(ready)).toEqual([])
    expect(missingForOrder({ ...ready, tableNumber: null, customerName: ' Ana ' })).toEqual([])
  })

  it('lists the service, then table or name, then products', () => {
    expect(missingForOrder({ ...ready, itemCount: 0, service: null, tableNumber: null })).toEqual(['service', 'table-or-name', 'products'])
    expect(missingForOrder({ ...ready, tableNumber: null, customerName: '   ' })).toEqual(['table-or-name'])
  })

  it('asks only for the name on takeaway orders', () => {
    expect(missingForOrder({ ...ready, service: 'takeaway', tableNumber: null })).toEqual(['name'])
    expect(missingForOrder({ ...ready, service: 'takeaway', tableNumber: null, customerName: 'Luis' })).toEqual([])
  })

  it('only needs products when adding to an open order', () => {
    expect(missingForOrder({ ...ready, adding: true, service: null, tableNumber: null })).toEqual([])
    expect(missingForOrder({ ...ready, adding: true, itemCount: 0 })).toEqual(['products'])
  })

  it('has a label for every missing piece', () => {
    expect(MISSING_LABEL).toEqual({
      service: 'elegir Aquí o Para llevar',
      'table-or-name': 'mesa o nombre del cliente',
      name: 'nombre del cliente',
      products: 'agregar productos',
    })
  })
})
