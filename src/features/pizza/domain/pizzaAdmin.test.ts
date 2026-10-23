import { describe, expect, it } from 'vitest'
import { extrasFormSchema, ingredientFormSchema, sizeFormSchema, styleFormSchema } from './pizzaAdmin'

const firstError = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? null : result.error?.issues[0]?.message

const style = {
  name: 'Estilo Nuevo',
  description: 'Jamón',
  kind: 'special' as const,
  includedIngredients: 0,
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

describe('extrasFormSchema', () => {
  it('needs positive prices', () => {
    expect(extrasFormSchema.safeParse({ extraIngredientCents: 500, extraCheeseCents: 3000 }).success).toBe(true)
    expect(firstError(extrasFormSchema.safeParse({ extraIngredientCents: 0, extraCheeseCents: 3000 }))).toBe(
      'El precio debe ser mayor a cero.',
    )
  })
})
