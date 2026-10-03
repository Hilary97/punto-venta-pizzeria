import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import type { PizzaCatalog, PizzaConfig } from '../domain/pizza'

const pizzaSizeCodeSchema = z.enum(['chica', 'mediana', 'grande'])

/** Snake_case pizza catalog as returned by `device_list_catalog`, mapped to the domain type. */
export const pizzaCatalogSchema = z
  .object({
    sizes: z.array(
      z.object({
        code: pizzaSizeCodeSchema,
        name: z.string(),
        allowed_portions: z.array(z.number().int()),
        sort_order: z.number(),
      }),
    ),
    styles: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        kind: z.enum(['special', 'custom']),
        included_ingredients: z.number().int(),
        sort_order: z.number(),
      }),
    ),
    ingredients: z.array(z.object({ id: z.string(), name: z.string(), sort_order: z.number() })),
  })
  .transform(
    (raw): PizzaCatalog => ({
      sizes: raw.sizes.map((size) => ({
        code: size.code,
        name: size.name,
        allowedPortions: size.allowed_portions,
        sortOrder: size.sort_order,
      })),
      styles: raw.styles.map((style) => ({
        id: style.id,
        name: style.name,
        description: style.description,
        kind: style.kind,
        includedIngredients: style.included_ingredients,
        sortOrder: style.sort_order,
      })),
      ingredients: raw.ingredients.map((ingredient) => ({
        id: ingredient.id,
        name: ingredient.name,
        sortOrder: ingredient.sort_order,
      })),
    }),
  )

/** Canonical snake_case pizza configuration (as stored in `order_items.pizza`), mapped to the domain type. */
export const pizzaConfigSchema = z
  .object({
    size: pizzaSizeCodeSchema,
    portions: z.array(
      z.object({
        style_id: z.string(),
        ingredient_ids: z.array(z.string()).default([]),
        extra_ingredient_ids: z.array(z.string()).default([]),
        extra_cheese: z.boolean().default(false),
      }),
    ),
  })
  .transform(
    (raw): PizzaConfig => ({
      size: raw.size,
      portions: raw.portions.map((portion) => ({
        styleId: portion.style_id,
        ingredientIds: portion.ingredient_ids,
        extraIngredientIds: portion.extra_ingredient_ids,
        extraCheese: portion.extra_cheese,
      })),
    }),
  )

/** Maps a pizza configuration to the snake_case shape the RPCs expect. */
export function toRpcPizzaConfig(config: PizzaConfig) {
  return {
    size: config.size,
    portions: config.portions.map((portion) => ({
      style_id: portion.styleId,
      ingredient_ids: portion.ingredientIds,
      extra_ingredient_ids: portion.extraIngredientIds,
      extra_cheese: portion.extraCheese,
    })),
  }
}

/** Sizes, active styles and active ingredients for a signed-in user. No prices. */
export async function listPizzaCatalog(): Promise<PizzaCatalog> {
  const client = getSupabaseClient()
  const [sizes, styles, ingredients] = await Promise.all([
    client.from('pizza_sizes').select('code, name, allowed_portions, sort_order').order('sort_order', { ascending: true }),
    client
      .from('pizza_styles')
      .select('id, name, description, kind, included_ingredients, sort_order')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    client
      .from('pizza_ingredients')
      .select('id, name, sort_order')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
  ])

  if (sizes.error || styles.error || ingredients.error) {
    throw new Error('No se pudo cargar el catálogo de pizzas.')
  }
  const parsed = pizzaCatalogSchema.safeParse({
    sizes: sizes.data,
    styles: styles.data,
    ingredients: ingredients.data,
  })
  if (!parsed.success) throw new Error('No se pudo cargar el catálogo de pizzas.')
  return parsed.data
}
