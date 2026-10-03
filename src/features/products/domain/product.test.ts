import { describe, expect, it } from 'vitest'
import { parseVariantsInput, productFormSchema } from './product'

const base = { categoryId: 'c1', name: 'Monster', priceCents: 100, active: true }

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

  it('rejects more than 8 variants', () => {
    const many = Array.from({ length: 9 }, (_, i) => `V${i}`)
    expect(productFormSchema.safeParse({ ...base, variants: many }).success).toBe(false)
  })

  it('rejects empty and over-long variants', () => {
    expect(productFormSchema.safeParse({ ...base, variants: [' '] }).success).toBe(false)
    expect(productFormSchema.safeParse({ ...base, variants: ['x'.repeat(41)] }).success).toBe(false)
  })
})
