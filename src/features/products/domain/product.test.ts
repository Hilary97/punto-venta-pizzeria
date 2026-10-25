import { describe, expect, it } from 'vitest'
import { isSoldOut, parseVariantsInput, productFormSchema, stockStatus, type Product } from './product'

const base = { categoryId: 'c1', name: 'Monster', priceCents: 100, active: true, trackStock: false, stockMin: 0 }

describe('parseVariantsInput', () => {
  it('splits on commas, trims and drops empty entries', () => {
    expect(parseVariantsInput(' Res, Pollo ,, ')).toEqual(['Res', 'Pollo'])
  })

  it('returns an empty list for blank text', () => {
    expect(parseVariantsInput('  ')).toEqual([])
  })
})

describe('productFormSchema variants', () => {
  it('accepts no variants and valid variants', () => {
    expect(productFormSchema.safeParse({ ...base, variants: [] }).success).toBe(true)
    expect(productFormSchema.safeParse({ ...base, variants: ['Res', 'Pollo'] }).success).toBe(true)
  })

  it('rejects case-insensitive duplicates', () => {
    expect(productFormSchema.safeParse({ ...base, variants: ['Res', 'res'] }).success).toBe(false)
  })

  it('accepts up to 16 variants and rejects more', () => {
    const variants = (length: number) => Array.from({ length }, (_, i) => `V${i}`)
    expect(productFormSchema.safeParse({ ...base, variants: variants(16) }).success).toBe(true)
    const tooMany = productFormSchema.safeParse({ ...base, variants: variants(17) })
    expect(tooMany.success).toBe(false)
    expect(tooMany.error?.issues[0]?.message).toBe('Máximo 16 variantes.')
  })

  it('rejects empty and over-long variants', () => {
    expect(productFormSchema.safeParse({ ...base, variants: [' '] }).success).toBe(false)
    expect(productFormSchema.safeParse({ ...base, variants: ['x'.repeat(41)] }).success).toBe(false)
  })
})

describe('stockStatus', () => {
  const product = (overrides: Partial<Product>): Product => ({ ...base, id: 'p1', variants: [], ...overrides })

  it('is untracked unless the product tracks stock', () => {
    expect(stockStatus(product({}))).toBe('untracked')
    expect(stockStatus(product({ trackStock: false, stock: 0 }))).toBe('untracked')
  })

  it('is out at zero, low at or below the minimum, ok above it', () => {
    expect(stockStatus(product({ trackStock: true, stock: 0, stockMin: 12 }))).toBe('out')
    expect(stockStatus(product({ trackStock: true, stock: 0, stockMin: 0 }))).toBe('out')
    expect(stockStatus(product({ trackStock: true, stock: 12, stockMin: 12 }))).toBe('low')
    expect(stockStatus(product({ trackStock: true, stock: 1, stockMin: 12 }))).toBe('low')
    expect(stockStatus(product({ trackStock: true, stock: 13, stockMin: 12 }))).toBe('ok')
    expect(stockStatus(product({ trackStock: true, stock: 1, stockMin: 0 }))).toBe('ok')
  })

  it('only blocks sold-out tracked products', () => {
    expect(isSoldOut(product({ trackStock: true, stock: 0 }))).toBe(true)
    expect(isSoldOut(product({ trackStock: true, stock: 1 }))).toBe(false)
    expect(isSoldOut(product({ trackStock: false, stock: 0 }))).toBe(false)
  })
})

describe('productFormSchema stock fields', () => {
  it('accepts tracking with a whole minimum of zero or more', () => {
    expect(productFormSchema.safeParse({ ...base, variants: [], trackStock: true, stockMin: 0 }).success).toBe(true)
    expect(productFormSchema.safeParse({ ...base, variants: [], trackStock: true, stockMin: 12 }).success).toBe(true)
  })

  it('rejects a negative or fractional minimum', () => {
    for (const stockMin of [-1, 1.5]) {
      const result = productFormSchema.safeParse({ ...base, variants: [], trackStock: true, stockMin })
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('El mínimo debe ser un número entero de 0 o más.')
    }
  })
})
