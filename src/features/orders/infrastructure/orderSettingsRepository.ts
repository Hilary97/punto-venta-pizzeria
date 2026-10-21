import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { parseRpcResult } from '../../../shared/supabase/rpc'

const orderSettingsSchema = z.object({ scheduled_lead_minutes: z.number().int() })

/** Minutes before the pickup time at which a scheduled order enters the kitchen queue. */
export async function getScheduledLeadMinutes(): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc('get_order_settings')
  return parseRpcResult(orderSettingsSchema, data, error, 'No se pudo cargar la anticipación.').scheduled_lead_minutes
}

/** Sets the lead minutes (admin only); the server validates the 0..240 range. */
export async function setScheduledLeadMinutes(minutes: number): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc('admin_set_scheduled_lead_minutes', { p_minutes: minutes })
  return parseRpcResult(orderSettingsSchema, data, error, 'No se pudo guardar la anticipación.').scheduled_lead_minutes
}
