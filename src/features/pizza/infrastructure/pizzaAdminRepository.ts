import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { parseRpcResult } from '../../../shared/supabase/rpc'
import type { PizzaSizeCode } from '../domain/pizza'
import type {
  AdminPizzaCatalog,
  ExtrasFormValues,
  IngredientFormValues,
  SizeFormValues,
  StyleFormValues,
} from '../domain/pizzaAdmin'

const LOAD_ERROR = 'No se pudo cargar la configuración de pizzas.'
const UNIQUE_VIOLATION = '23505'

/** Every size, style (with prices), ingredient and the extras, including inactive rows (admin view). */
export async function listAdminPizzaCatalog(): Promise<AdminPizzaCatalog> {
  const client = getSupabaseClient()
  const [sizes, styles, prices, ingredients, settings] = await Promise.all([
    client.from('pizza_sizes').select('code, name, allowed_portions, sort_order').order('sort_order', { ascending: true }),
    client
      .from('pizza_styles')
      .select('id, name, description, kind, included_ingredients, sort_order, active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    client.from('pizza_style_prices').select('style_id, size_code, price_cents'),
    client
      .from('pizza_ingredients')
      .select('id, name, sort_order, active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    client.from('pizza_settings').select('extra_ingredient_cents, extra_cheese_cents').eq('id', true).single(),
  ])

  if (sizes.error || styles.error || prices.error || ingredients.error || settings.error || !settings.data) {
    throw new Error(LOAD_ERROR)
  }

  const pricesByStyle = new Map<string, Partial<Record<PizzaSizeCode, number>>>()
  for (const price of prices.data) {
    const entry = pricesByStyle.get(price.style_id) ?? {}
    entry[price.size_code] = price.price_cents
    pricesByStyle.set(price.style_id, entry)
  }

  return {
    sizes: sizes.data.map((size) => ({
      code: size.code,
      name: size.name,
      allowedPortions: size.allowed_portions,
      sortOrder: size.sort_order,
    })),
    styles: styles.data.map((style) => ({
      id: style.id,
      name: style.name,
      description: style.description,
      kind: style.kind,
      includedIngredients: style.included_ingredients,
      sortOrder: style.sort_order,
      active: style.active,
      prices: pricesByStyle.get(style.id) ?? {},
    })),
    ingredients: ingredients.data.map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      sortOrder: ingredient.sort_order,
      active: ingredient.active,
    })),
    extras: {
      extraIngredientCents: settings.data.extra_ingredient_cents,
      extraCheeseCents: settings.data.extra_cheese_cents,
    },
  }
}

/** The unique index on the name is the only one an ingredient form can hit. */
function ingredientErrorMessage(error: { code?: string }, fallback: string): string {
  return error.code === UNIQUE_VIOLATION ? 'Ya existe un ingrediente con ese nombre.' : fallback
}

export async function createIngredient(values: IngredientFormValues): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('pizza_ingredients')
    .insert({ name: values.name, sort_order: values.sortOrder, active: values.active })
  if (error) throw new Error(ingredientErrorMessage(error, 'No se pudo crear el ingrediente.'))
}

export async function updateIngredient(id: string, values: IngredientFormValues): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('pizza_ingredients')
    .update({ name: values.name, sort_order: values.sortOrder, active: values.active })
    .eq('id', id)
  if (error) throw new Error(ingredientErrorMessage(error, 'No se pudo actualizar el ingrediente.'))
}

export async function setIngredientActive(id: string, active: boolean): Promise<void> {
  const { error } = await getSupabaseClient().from('pizza_ingredients').update({ active }).eq('id', id)
  if (error) throw new Error('No se pudo cambiar el estado del ingrediente.')
}

const savedStyleSchema = z.object({ style_id: z.string() }).transform((row) => row.style_id)

/** Creates (`id` null) or updates a style together with its three prices; returns the style id. */
export async function saveStyle(id: string | null, values: StyleFormValues): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc('admin_save_pizza_style', {
    p_style_id: id,
    p_name: values.name,
    p_description: values.description,
    p_kind: values.kind,
    p_included_ingredients: values.includedIngredients,
    p_sort_order: values.sortOrder,
    p_active: values.active,
    p_prices: values.prices,
  })
  return parseRpcResult(savedStyleSchema, data, error, 'No se pudo guardar el estilo.')
}

export async function setStyleActive(id: string, active: boolean): Promise<void> {
  const { error } = await getSupabaseClient().from('pizza_styles').update({ active }).eq('id', id)
  if (error) throw new Error('No se pudo cambiar el estado del estilo.')
}

export async function updateSize(code: PizzaSizeCode, values: SizeFormValues): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('pizza_sizes')
    .update({ name: values.name, allowed_portions: [...values.allowedPortions].sort((a, b) => a - b) })
    .eq('code', code)
  if (error) throw new Error('No se pudo actualizar el tamaño.')
}

export async function updateExtras(values: ExtrasFormValues): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('pizza_settings')
    .update({ extra_ingredient_cents: values.extraIngredientCents, extra_cheese_cents: values.extraCheeseCents })
    .eq('id', true)
  if (error) throw new Error('No se pudieron actualizar los extras.')
}
