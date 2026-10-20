import { describe, expect, it } from 'vitest'
import {
  SUPPLY_UNIT_LABELS,
  currentMonthRange,
  parseQuantityInput,
  purchaseRange,
  supplyFormSchema,
  supplyStatus,
} from './supply'

describe('SUPPLY_UNIT_LABELS', () => {
  it('labels every unit', () => {
    expect(SUPPLY_UNIT_LABELS).toEqual({ kg: 'kg', g: 'g', l: 'L', ml: 'ml', pz: 'pz' })
  })
})

describe('supplyStatus', () => {
  it('is ok only above the minimum', () => {
    expect(supplyStatus({ stock: 5.001, stockMin: 5 })).toBe('ok')
  })

  it('is buy at or below the minimum', () => {
    expect(supplyStatus({ stock: 5, stockMin: 5 })).toBe('buy')
    expect(supplyStatus({ stock: 0, stockMin: 5 })).toBe('buy')
  })

  it('is buy at zero stock with zero minimum', () => {
    expect(supplyStatus({ stock: 0, stockMin: 0 })).toBe('buy')
    expect(supplyStatus({ stock: 0.5, stockMin: 0 })).toBe('ok')
  })
})

describe('supplyFormSchema', () => {
  const valid = { name: 'Queso', unit: 'kg', stockMin: 2.5, active: true }

  it('accepts a valid supply and trims the name', () => {
    const res = supplyFormSchema.safeParse({ ...valid, name: '  Queso  ' })
    expect(res.success && res.data.name).toBe('Queso')
  })

  it('rejects blank and over-long names with a Spanish message', () => {
    const blank = supplyFormSchema.safeParse({ ...valid, name: '   ' })
    expect(!blank.success && blank.error.issues[0]?.message).toBe('El nombre es obligatorio.')
    expect(supplyFormSchema.safeParse({ ...valid, name: 'x'.repeat(81) }).success).toBe(false)
    expect(supplyFormSchema.safeParse({ ...valid, name: 'x'.repeat(80) }).success).toBe(true)
  })

  it('rejects units outside the list', () => {
    const res = supplyFormSchema.safeParse({ ...valid, unit: 'kilo' })
    expect(!res.success && res.error.issues[0]?.message).toBe('Elige una unidad.')
  })

  it('rejects a negative minimum or more than 3 decimals', () => {
    const neg = supplyFormSchema.safeParse({ ...valid, stockMin: -1 })
    expect(!neg.success && neg.error.issues[0]?.message).toBe('El mínimo debe ser 0 o más, con hasta 3 decimales.')
    expect(supplyFormSchema.safeParse({ ...valid, stockMin: 1.2345 }).success).toBe(false)
    expect(supplyFormSchema.safeParse({ ...valid, stockMin: 0 }).success).toBe(true)
    expect(supplyFormSchema.safeParse({ ...valid, stockMin: 1.234 }).success).toBe(true)
  })
})

describe('parseQuantityInput', () => {
  it('parses integers and decimals', () => {
    expect(parseQuantityInput('10')).toBe(10)
    expect(parseQuantityInput('2.5')).toBe(2.5)
    expect(parseQuantityInput('0.250')).toBe(0.25)
    expect(parseQuantityInput(' 3 ')).toBe(3)
    expect(parseQuantityInput('0')).toBe(0)
  })

  it('accepts a comma decimal', () => {
    expect(parseQuantityInput('2,5')).toBe(2.5)
  })

  it('rejects thousands-looking commas instead of guessing a decimal', () => {
    for (const text of ['1,000', '12,500', '1,000,000', '1,000.5']) {
      expect(parseQuantityInput(text), text).toBeNull()
    }
    expect(parseQuantityInput('0,250')).toBe(0.25)
    expect(parseQuantityInput('2,50')).toBe(2.5)
  })

  it('returns null for empty, negative, invalid or over-precise input', () => {
    for (const text of ['', '  ', '-1', '-0.5', 'abc', '1.2.3', '1,2,3', '0.0001', '2,5555', '.', ',']) {
      expect(parseQuantityInput(text), text).toBeNull()
    }
  })
})

describe('purchaseRange', () => {
  it('spans from the start of the first day to the start of the day after the last', () => {
    const { from, to } = purchaseRange('2026-10-01', '2026-10-31')
    expect(from).toBe(new Date(2026, 9, 1).toISOString())
    expect(to).toBe(new Date(2026, 10, 1).toISOString())
  })

  it('covers a single day', () => {
    const { from, to } = purchaseRange('2026-10-15', '2026-10-15')
    expect(from).toBe(new Date(2026, 9, 15).toISOString())
    expect(to).toBe(new Date(2026, 9, 16).toISOString())
  })

  it('rolls over month and year ends', () => {
    expect(purchaseRange('2026-12-31', '2026-12-31').to).toBe(new Date(2027, 0, 1).toISOString())
  })
})

describe('currentMonthRange', () => {
  it('returns the first and last day of the month', () => {
    expect(currentMonthRange(new Date(2026, 9, 20, 15, 30))).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(currentMonthRange(new Date(2026, 1, 10))).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(currentMonthRange(new Date(2028, 1, 10))).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })
})
