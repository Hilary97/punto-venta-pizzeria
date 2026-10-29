import { describe, expect, it } from 'vitest'
import { extraFormSchema,
  extraIngredientPriceFormSchema, ingredientFormSchema, sizeFormSchema, styleFormSchema } from './pizzaAdmin'

const firstError = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? null : result.error?.issues[0]?.message

const style = {
  name: 'Estilo Nuevo',
  description: 'Jamón',
  kind: 'special' as const,
  includedIngredients: 0,
  splitFees: { halves: 1000, thirds: 2000, quarters: 3000 },
  sortOrder: 20,
  active: true,
  prices: { chica: 11000, mediana: 19000, grande: 21000 },
}

describe('ingredientFormSchema', () => {
  it('trims the name and accepts an order between 0 and 10000', () => {
    expect(ingredientFormSchema.parse({ name: '  Elote ', sortOrder: 16, active: true })).toEqual({
      name: 'Elote',
      sortOrder: 16,
      active: true,
    })
  })

  it('rejects a blank name and an invalid order', () => {
    expect(firstError(ingredientFormSchema.safeParse({ name: '  ', sortOrder: 1, active: true }))).toBe(
      'El nombre es obligatorio.',
    )
    expect(firstError(ingredientFormSchema.safeParse({ name: 'Elote', sortOrder: -1, active: true }))).toBe(
      'El orden debe ser un número entero entre 0 y 10000.',
    )
    expect(firstError(ingredientFormSchema.safeParse({ name: 'Elote', sortOrder: 1.5, active: true }))).toBe(
      'El orden debe ser un número entero entre 0 y 10000.',
    )
  })
})

describe('styleFormSchema', () => {
  it('accepts a special style and a custom style with 1-4 included ingredients', () => {
    expect(styleFormSchema.safeParse(style).success).toBe(true)
    expect(styleFormSchema.safeParse({ ...style, kind: 'custom', includedIngredients: 4 }).success).toBe(true)
  })

  it('keeps 0-4 included ingredients on a special style', () => {
    expect(styleFormSchema.parse({ ...style, includedIngredients: 2 }).includedIngredients).toBe(2)
    expect(styleFormSchema.parse({ ...style, includedIngredients: 0 }).includedIngredients).toBe(0)
    expect(firstError(styleFormSchema.safeParse({ ...style, includedIngredients: 5 }))).toBe(
      'Los ingredientes incluidos deben estar entre 0 y 4.',
    )
  })

  it('requires the three elaboration fees', () => {
    expect(styleFormSchema.safeParse({ ...style, splitFees: undefined }).success).toBe(false)
    expect(styleFormSchema.safeParse({ ...style, splitFees: { halves: 1000, thirds: 2000 } }).success).toBe(false)
  })

  it('accepts a $0 elaboration fee because it turns the fee off', () => {
    const free = { halves: 0, thirds: 0, quarters: 0 }
    expect(styleFormSchema.parse({ ...style, splitFees: free }).splitFees).toEqual(free)
  })

  it('rejects negative, fractional and too high elaboration fees', () => {
    const fees = style.splitFees
    expect(firstError(styleFormSchema.safeParse({ ...style, splitFees: { ...fees, halves: -1 } }))).toBe(
      'El cargo debe ser un monto válido de cero o más.',
    )
    expect(firstError(styleFormSchema.safeParse({ ...style, splitFees: { ...fees, thirds: 10.5 } }))).toBe(
      'El cargo debe ser un monto válido de cero o más.',
    )
    expect(firstError(styleFormSchema.safeParse({ ...style, splitFees: { ...fees, quarters: 10_000_001 } }))).toBe(
      'El precio es demasiado alto.',
    )
    expect(styleFormSchema.safeParse({ ...style, splitFees: { ...fees, quarters: 10_000_000 } }).success).toBe(true)
  })

  it('rejects a custom style outside 1-4 included ingredients', () => {
    for (const includedIngredients of [0, 5]) {
      expect(firstError(styleFormSchema.safeParse({ ...style, kind: 'custom', includedIngredients }))).toBe(
        'Los ingredientes incluidos deben estar entre 1 y 4.',
      )
    }
  })

  it('rejects a non-positive price', () => {
    expect(firstError(styleFormSchema.safeParse({ ...style, prices: { ...style.prices, grande: 0 } }))).toBe(
      'El precio debe ser mayor a cero.',
    )
  })
})

describe('sizeFormSchema', () => {
  it('needs a name and at least one portion count between 1 and 4', () => {
    expect(sizeFormSchema.safeParse({ name: 'Grande', allowedPortions: [1, 2] }).success).toBe(true)
    expect(firstError(sizeFormSchema.safeParse({ name: 'Grande', allowedPortions: [] }))).toBe(
      'Elige al menos una forma de dividir la pizza.',
    )
    expect(firstError(sizeFormSchema.safeParse({ name: ' ', allowedPortions: [1] }))).toBe('El nombre es obligatorio.')
  })
})

describe('extraIngredientPriceFormSchema', () => {
  it('needs a positive price', () => {
    expect(extraIngredientPriceFormSchema.safeParse({ extraIngredientCents: 500 }).success).toBe(true)
    expect(firstError(extraIngredientPriceFormSchema.safeParse({ extraIngredientCents: 0 }))).toBe(
      'El precio debe ser mayor a cero.',
    )
  })
})

describe('extraFormSchema', () => {
  const valid = { name: ' Orilla rellena ', priceCents: 4000, sortOrder: 2, active: true }

  it('trims the name and accepts a positive price', () => {
    expect(extraFormSchema.parse(valid)).toEqual({ ...valid, name: 'Orilla rellena' })
  })

  it('needs a name, a positive price and a valid order', () => {
    expect(firstError(extraFormSchema.safeParse({ ...valid, name: ' ' }))).toBe('El nombre es obligatorio.')
    expect(firstError(extraFormSchema.safeParse({ ...valid, name: 'x'.repeat(61) }))).toBe('El nombre es demasiado largo.')
    expect(firstError(extraFormSchema.safeParse({ ...valid, priceCents: 0 }))).toBe('El precio debe ser mayor a cero.')
    expect(firstError(extraFormSchema.safeParse({ ...valid, sortOrder: -1 }))).toBe(
      'El orden debe ser un número entero entre 0 y 10000.',
    )
  })
})
