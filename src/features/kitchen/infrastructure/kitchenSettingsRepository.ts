import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { parseRpcResult } from '../../../shared/supabase/rpc'

const LOAD_ERROR = 'No se pudo cargar el estado de la cocina.'
const SAVE_ERROR = 'No se pudo cambiar el estado de la cocina.'

/** Whether orders go through the Cocina and Entrega screens. */
export async function fetchKitchenEnabled(): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc('kitchen_enabled')
  return parseRpcResult(z.boolean(), data, error, LOAD_ERROR)
}

/** Admin only. Switching off finishes every pending kitchen and delivery line. */
export async function setKitchenEnabled(enabled: boolean): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc('set_kitchen_enabled', { p_enabled: enabled })
  return parseRpcResult(z.boolean(), data, error, SAVE_ERROR)
}
