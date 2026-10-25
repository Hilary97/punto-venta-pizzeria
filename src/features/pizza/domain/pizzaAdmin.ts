import { z } from 'zod'
import type { PizzaSizeCode, PizzaStyle } from './pizza'

/** A size as the admin edits it; the three codes are fixed (daily dough is tracked per size). */
export interface AdminPizzaSize {
  code: PizzaSizeCode
  name: string
  allowedPortions: number[]
  sortOrder: number
}

/** A style, active or not, with its price in cents per size. */
export interface AdminPizzaStyle extends PizzaStyle {
  active: boolean
  prices: Partial<Record<PizzaSizeCode, number>>
}

export interface AdminPizzaIngredient {
  id: string
  name: string
  sortOrder: number
  active: boolean
}

/** An extra toggled per portion, active or not, with its price in cents per portion. */
export interface AdminPizzaExtra {
  id: string
  name: string
  priceCents: number
  sortOrder: number
  active: boolean
}

/** Everything the pizza builder reads, including inactive rows and prices. */
export interface AdminPizzaCatalog {
  sizes: AdminPizzaSize[]
  styles: AdminPizzaStyle[]
  ingredients: AdminPizzaIngredient[]
  /** Price charged per portion for each extra ingredient. */
  extraIngredientCents: number
  extras: AdminPizzaExtra[]
}

export const MAX_PORTIONS = 4
export const MIN_CUSTOM_INGREDIENTS = 1
export const MAX_CUSTOM_INGREDIENTS = 4

const NAME_REQUIRED = 'El nombre es obligatorio.'
const ORDER_ERROR = 'El orden debe ser un número entero entre 0 y 10000.'
const PRICE_ERROR = 'El precio debe ser mayor a cero.'
const INCLUDED_ERROR = 'Los ingredientes incluidos deben estar entre 1 y 4.'

const sortOrderSchema = z
  .number()
  .int({ error: ORDER_ERROR })
  .min(0, { error: ORDER_ERROR })
  .max(10000, { error: ORDER_ERROR })

// Same upper bound as admin_save_pizza_style: $100,000.
const priceSchema = z.number().int({ error: PRICE_ERROR }).positive({ error: PRICE_ERROR }).max(10_000_000, {
  error: 'El precio es demasiado alto.',
})

export const ingredientFormSchema = z.object({
  name: z.string().trim().min(1, { error: NAME_REQUIRED }).max(60, { error: 'El nombre es demasiado largo.' }),
  sortOrder: sortOrderSchema,
  active: z.boolean(),
})

export type IngredientFormValues = z.infer<typeof ingredientFormSchema>

export const styleFormSchema = z
  .object({
    name: z.string().trim().min(1, { error: NAME_REQUIRED }).max(80, { error: 'El nombre es demasiado largo.' }),
    description: z.string().trim().max(300, { error: 'La descripción del estilo es demasiado larga.' }),
    kind: z.enum(['special', 'custom'], { error: 'El tipo de estilo no es válido.' }),
    includedIngredients: z.number().int({ error: INCLUDED_ERROR }),
    sortOrder: sortOrderSchema,
    active: z.boolean(),
    prices: z.object({ chica: priceSchema, mediana: priceSchema, grande: priceSchema }),
  })
  .refine(
    (style) =>
      style.kind === 'special' ||
      (style.includedIngredients >= MIN_CUSTOM_INGREDIENTS && style.includedIngredients <= MAX_CUSTOM_INGREDIENTS),
    { error: INCLUDED_ERROR, path: ['includedIngredients'] },
  )
  .transform((style) => ({ ...style, includedIngredients: style.kind === 'special' ? 0 : style.includedIngredients }))

export type StyleFormValues = z.infer<typeof styleFormSchema>

export const sizeFormSchema = z.object({
  name: z.string().trim().min(1, { error: NAME_REQUIRED }).max(30, { error: 'El nombre es demasiado largo.' }),
  allowedPortions: z
    .array(z.number().int().min(1).max(MAX_PORTIONS))
    .min(1, { error: 'Elige al menos una forma de dividir la pizza.' }),
})

export type SizeFormValues = z.infer<typeof sizeFormSchema>

export const extraIngredientPriceFormSchema = z.object({
  extraIngredientCents: priceSchema,
})

export type ExtraIngredientPriceFormValues = z.infer<typeof extraIngredientPriceFormSchema>

export const extraFormSchema = z.object({
  name: z.string().trim().min(1, { error: NAME_REQUIRED }).max(60, { error: 'El nombre es demasiado largo.' }),
  priceCents: priceSchema,
  sortOrder: sortOrderSchema,
  active: z.boolean(),
})

export type ExtraFormValues = z.infer<typeof extraFormSchema>
