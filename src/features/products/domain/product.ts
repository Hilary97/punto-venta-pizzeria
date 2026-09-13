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
})

export type ProductFormValues = z.infer<typeof productFormSchema>
