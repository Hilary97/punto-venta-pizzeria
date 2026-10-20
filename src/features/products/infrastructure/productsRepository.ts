import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { parseRpcResult } from '../../../shared/supabase/rpc'
import type { Category, CategoryFormValues, Product, ProductFormValues } from '../domain/product'

export async function listCategories(): Promise<Category[]> {
  const { data, error } = await getSupabaseClient()
    .from('categories')
    .select('id, name, sort_order')
    .order('sort_order', { ascending: true })

  if (error) throw new Error('No se pudieron cargar las categorías.')

  return data.map((row) => ({ id: row.id, name: row.name, sortOrder: row.sort_order }))
}

/** Lists products. When `onlyActive` is true, returns only active products (POS grid). */
export async function listProducts(onlyActive = false): Promise<Product[]> {
  let query = getSupabaseClient()
    .from('products')
    .select('id, category_id, name, price_cents, active, variants, track_stock, stock, stock_min')
    .order('name', { ascending: true })

  if (onlyActive) {
    query = query.eq('active', true)
  }

  const { data, error } = await query
  if (error) throw new Error('No se pudieron cargar los productos.')

  return data.map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    priceCents: row.price_cents,
    active: row.active,
    variants: row.variants,
    trackStock: row.track_stock,
    stock: row.stock,
    stockMin: row.stock_min,
  }))
}

export async function createCategory(values: CategoryFormValues): Promise<void> {
  const { error } = await getSupabaseClient().from('categories').insert({ name: values.name })
  if (error) throw new Error('No se pudo crear la categoría.')
}

export async function updateCategory(id: string, values: CategoryFormValues): Promise<void> {
  const { error } = await getSupabaseClient().from('categories').update({ name: values.name }).eq('id', id)
  if (error) throw new Error('No se pudo actualizar la categoría.')
}

export async function createProduct(values: ProductFormValues): Promise<void> {
  const { error } = await getSupabaseClient().from('products').insert({
    category_id: values.categoryId,
    name: values.name,
    price_cents: values.priceCents,
    active: values.active,
    variants: values.variants,
    track_stock: values.trackStock,
    stock_min: values.stockMin,
  })
  if (error) throw new Error('No se pudo crear el producto.')
}

export async function updateProduct(id: string, values: ProductFormValues): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('products')
    .update({
      category_id: values.categoryId,
      name: values.name,
      price_cents: values.priceCents,
      active: values.active,
      variants: values.variants,
      track_stock: values.trackStock,
      stock_min: values.stockMin,
    })
    .eq('id', id)
  if (error) throw new Error('No se pudo actualizar el producto.')
}

export async function setProductActive(id: string, active: boolean): Promise<void> {
  const { error } = await getSupabaseClient().from('products').update({ active }).eq('id', id)
  if (error) throw new Error('No se pudo cambiar el estado del producto.')
}

const stockResultSchema = z
  .object({ product_id: z.string(), stock: z.number().int() })
  .transform((row) => ({ productId: row.product_id, stock: row.stock }))

export interface StockResult {
  productId: string
  stock: number
}

/** Adds received units to the stock atomically (admin only). */
export async function receiveStock(productId: string, quantity: number): Promise<StockResult> {
  const { data, error } = await getSupabaseClient().rpc('admin_receive_stock', {
    p_product_id: productId,
    p_quantity: quantity,
  })
  return parseRpcResult(stockResultSchema, data, error, 'No se pudo registrar la entrada.')
}

/** Sets the stock to the counted value (admin only). */
export async function countStock(productId: string, stock: number): Promise<StockResult> {
  const { data, error } = await getSupabaseClient().rpc('admin_count_stock', {
    p_product_id: productId,
    p_stock: stock,
  })
  return parseRpcResult(stockResultSchema, data, error, 'No se pudo registrar el conteo.')
}
