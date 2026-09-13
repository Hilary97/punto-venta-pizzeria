import { getSupabaseClient } from '../../../shared/supabase/client'
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
    .select('id, category_id, name, price_cents, active')
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
    })
    .eq('id', id)
  if (error) throw new Error('No se pudo actualizar el producto.')
}

export async function setProductActive(id: string, active: boolean): Promise<void> {
  const { error } = await getSupabaseClient().from('products').update({ active }).eq('id', id)
  if (error) throw new Error('No se pudo cambiar el estado del producto.')
}
