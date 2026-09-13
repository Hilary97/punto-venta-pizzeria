import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { parseRpcResult } from '../../../shared/supabase/rpc'
import type { SaleItemPayload } from '../domain/sale'

const createSaleResultSchema = z.object({
  sale_id: z.string(),
  total_cents: z.number().int(),
  change_cents: z.number().int(),
})

export interface CreateSaleResult {
  saleId: string
  totalCents: number
  changeCents: number
}

/**
 * Registers a sale through the `create_sale` security-definer RPC. The
 * server re-reads prices from `products`; the client only sends product
 * ids and quantities plus the cash received, so a tampered client-side
 * price can never be charged.
 */
export async function createSale(items: SaleItemPayload[], receivedCents: number): Promise<CreateSaleResult> {
  const { data, error } = await getSupabaseClient().rpc('create_sale', {
    p_items: items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
    p_received_cents: receivedCents,
  })

  const result = parseRpcResult(createSaleResultSchema, data, error, 'No se pudo registrar la venta.')

  return { saleId: result.sale_id, totalCents: result.total_cents, changeCents: result.change_cents }
}
