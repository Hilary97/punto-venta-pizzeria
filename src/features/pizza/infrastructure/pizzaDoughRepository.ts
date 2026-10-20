import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { parseRpcResult } from '../../../shared/supabase/rpc'
import type { PizzaDoughDay } from '../domain/pizzaDough'

const pizzaDoughSchema = z
  .object({
    business_day: z.string(),
    sizes: z.array(
      z.object({
        size_code: z.string(),
        name: z.string(),
        prepared: z.number().int().nullable(),
        used: z.number().int().nullable(),
        left: z.number().int().nullable(),
      }),
    ),
  })
  .transform(
    (raw): PizzaDoughDay => ({
      businessDay: raw.business_day,
      sizes: raw.sizes.map((size) => ({
        sizeCode: size.size_code,
        name: size.name,
        prepared: size.prepared,
        used: size.used,
        left: size.left,
      })),
    }),
  )

/** Today's doughs per size (admin only). Sizes without a row come back with null counts. */
export async function listPizzaDough(): Promise<PizzaDoughDay> {
  const { data, error } = await getSupabaseClient().rpc('admin_list_pizza_dough')
  return parseRpcResult(pizzaDoughSchema, data, error, 'No se pudieron cargar las masas.')
}

/** Sets today's prepared doughs of a size (admin only); the server rejects less than already used. */
export async function setPizzaDough(sizeCode: string, prepared: number): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('admin_set_pizza_dough', {
    p_size_code: sizeCode,
    p_prepared: prepared,
  })
  parseRpcResult(z.unknown(), data, error, 'No se pudieron guardar las masas.')
}
