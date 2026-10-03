import { z } from 'zod'

export interface Category {
  id: string
  name: string
  sortOrder: number
}

export interface Product {
  id: string
  categoryId: string
  name: string
  priceCents: number
  active: boolean
  /** Choices the waiter must pick from when adding the product; empty when none. */
  variants: string[]
}

export const categoryFormSchema = z.object({
  name: z.string().min(1, { error: 'El nombre es obligatorio.' }).max(80),
})

export type CategoryFormValues = z.infer<typeof categoryFormSchema>

export const productFormSchema = z.object({
  categoryId: z.string().min(1, { error: 'Selecciona una categoría.' }),
  name: z.string().min(1, { error: 'El nombre es obligatorio.' }).max(120),
  priceCents: z.number().int().positive({ error: 'El precio debe ser mayor a cero.' }),
  active: z.boolean(),
  variants: z
    .array(z.string().trim().min(1, { error: 'Las variantes no pueden estar vacías.' }).max(40))
    .max(8, { error: 'Máximo 8 variantes.' })
    .refine((list) => new Set(list.map((v) => v.toLowerCase())).size === list.length, {
      error: 'Las variantes no pueden repetirse.',
    }),
})

export type ProductFormValues = z.infer<typeof productFormSchema>

/** Parses comma-separated text from the admin form into a trimmed list without empty entries. */
export function parseVariantsInput(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
}
