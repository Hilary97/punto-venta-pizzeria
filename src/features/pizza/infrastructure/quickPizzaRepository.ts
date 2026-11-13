import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { parseRpcResult } from '../../../shared/supabase/rpc'
import type { PizzaConfig } from '../domain/pizza'
import { pizzaConfigSchema, toRpcPizzaConfig } from './pizzaRepository'

/** A pizza fixed by an admin in "Pizzas rápidas"; `available` is false when it is no longer valid. */
export interface QuickPizza {
  id: string
  pizza: PizzaConfig
  available: boolean
}

const quickPizzasSchema = z.array(z.object({ id: z.string(), pizza: pizzaConfigSchema, available: z.boolean() }))
const idSchema = z.object({ id: z.string() })

export async function listQuickPizzas(): Promise<QuickPizza[]> {
  const { data, error } = await getSupabaseClient().rpc('admin_list_quick_pizzas')
  return parseRpcResult(quickPizzasSchema, data, error, 'No se pudieron cargar las pizzas rápidas.')
}

export async function addQuickPizza(pizza: PizzaConfig): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('admin_add_quick_pizza', { p_config: toRpcPizzaConfig(pizza) })
  parseRpcResult(idSchema, data, error, 'No se pudo fijar la pizza.')
}

export async function deleteQuickPizza(id: string): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('admin_delete_quick_pizza', { p_id: id })
  parseRpcResult(idSchema, data, error, 'No se pudo quitar la pizza.')
}

export async function moveQuickPizza(id: string, direction: -1 | 1): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('admin_move_quick_pizza', { p_id: id, p_direction: direction })
  parseRpcResult(idSchema, data, error, 'No se pudo mover la pizza.')
}
