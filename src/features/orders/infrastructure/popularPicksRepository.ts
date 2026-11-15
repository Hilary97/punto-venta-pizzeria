import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { pizzaConfigSchema } from '../../pizza/infrastructure/pizzaRepository'
import type { PopularPick } from '../domain/ordersSource'

export const POPULAR_PICKS_ERROR = 'No se pudieron cargar los más vendidos.'

/** "Más vendidas" as returned by `list_popular_picks` / `device_list_popular_picks`. */
export const popularPicksSchema = z
  .array(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('pizza'), pizza: pizzaConfigSchema }),
      z.object({ kind: z.literal('product'), product_id: z.string().min(1), variant: z.string().nullable() }),
    ]),
  )
  .transform((rows): PopularPick[] =>
    rows.map((row) =>
      row.kind === 'pizza'
        ? { kind: 'pizza', pizza: row.pizza }
        : { kind: 'product', productId: row.product_id, variant: row.variant },
    ),
  )

/** Fixed pizzas first, then best-selling pizzas and products of the last 30 days (signed-in admin or cashier). */
export async function listPopularPicks(): Promise<PopularPick[]> {
  const { data, error } = await getSupabaseClient().rpc('list_popular_picks')
  if (error) throw new Error(POPULAR_PICKS_ERROR)
  return popularPicksSchema.parse(data)
}
