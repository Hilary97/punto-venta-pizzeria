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
  /** Whether orders deduct stock; omitted means not tracked. */
  trackStock?: boolean
  /** Units left; only meaningful when `trackStock` is true. */
  stock?: number
  /** At or below this many units the product counts as low stock. */
  stockMin?: number
}

export type StockStatus = 'untracked' | 'ok' | 'low' | 'out'

export function stockStatus(product: Pick<Product, 'trackStock' | 'stock' | 'stockMin'>): StockStatus {
  if (!product.trackStock) return 'untracked'
  const stock = product.stock ?? 0
  if (stock <= 0) return 'out'
  return stock <= (product.stockMin ?? 0) ? 'low' : 'ok'
}

/** A tracked product with no units left: orders cannot take it. */
export function isSoldOut(product: Pick<Product, 'trackStock' | 'stock' | 'stockMin'>): boolean {
  return stockStatus(product) === 'out'
}

export const categoryFormSchema = z.object({
  name: z.string().min(1, { error: 'El nombre es obligatorio.' }).max(80),
})

export type CategoryFormValues = z.infer<typeof categoryFormSchema>

const STOCK_MIN_ERROR = 'El mínimo debe ser un número entero de 0 o más.'

export const productFormSchema = z.object({
  categoryId: z.string().min(1, { error: 'Selecciona una categoría.' }),
  name: z.string().min(1, { error: 'El nombre es obligatorio.' }).max(120),
  priceCents: z.number().int().positive({ error: 'El precio debe ser mayor a cero.' }),
  active: z.boolean(),
  variants: z
    .array(z.string().trim().min(1, { error: 'Las variantes no pueden estar vacías.' }).max(40))
    .max(15, { error: 'Máximo 15 variantes.' })
    .refine((list) => new Set(list.map((v) => v.toLowerCase())).size === list.length, {
      error: 'Las variantes no pueden repetirse.',
    }),
  trackStock: z.boolean(),
  stockMin: z.number().int({ error: STOCK_MIN_ERROR }).min(0, { error: STOCK_MIN_ERROR }),
})

export type ProductFormValues = z.infer<typeof productFormSchema>

/** Parses comma-separated text from the admin form into a trimmed list without empty entries. */
export function parseVariantsInput(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
}
