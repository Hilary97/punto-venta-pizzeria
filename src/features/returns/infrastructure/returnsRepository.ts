import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { parseRpcResult } from '../../../shared/supabase/rpc'
import type { SaleWithItems } from '../../sales/domain/sale'

/** Lists the sales (with line items and already-returned quantities) for the given cash session. */
export async function listSessionSalesWithItems(sessionId: string): Promise<SaleWithItems[]> {
  const supabase = getSupabaseClient()

  const { data: sales, error: salesError } = await supabase
    .from('sales')
    .select('id, created_at, total_cents, received_cents, change_cents')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })

  if (salesError) throw new Error('No se pudieron cargar las ventas.')
  if (sales.length === 0) return []

  const saleIds = sales.map((sale) => sale.id)

  const { data: items, error: itemsError } = await supabase
    .from('sale_items')
    .select('id, sale_id, product_id, product_name, unit_price_cents, quantity')
    .in('sale_id', saleIds)

  if (itemsError) throw new Error('No se pudieron cargar los artículos vendidos.')

  const returnedBySaleItem = new Map<string, number>()
  if (items.length > 0) {
    const { data: returnItems, error: returnItemsError } = await supabase
      .from('return_items')
      .select('sale_item_id, quantity')
      .in(
        'sale_item_id',
        items.map((item) => item.id),
      )

    if (returnItemsError) throw new Error('No se pudieron cargar las devoluciones previas.')

    for (const returnItem of returnItems) {
      returnedBySaleItem.set(
        returnItem.sale_item_id,
        (returnedBySaleItem.get(returnItem.sale_item_id) ?? 0) + returnItem.quantity,
      )
    }
  }

  return sales.map((sale) => ({
    id: sale.id,
    createdAt: sale.created_at,
    totalCents: sale.total_cents,
    receivedCents: sale.received_cents,
    changeCents: sale.change_cents,
    items: items
      .filter((item) => item.sale_id === sale.id)
      .map((item) => ({
        id: item.id,
        productId: item.product_id,
        productName: item.product_name,
        unitPriceCents: item.unit_price_cents,
        quantity: item.quantity,
        returnedQuantity: returnedBySaleItem.get(item.id) ?? 0,
      })),
  }))
}

export interface ReturnItemPayload {
  saleItemId: string
  quantity: number
}

const createReturnResultSchema = z.object({
  return_id: z.string(),
  total_cents: z.number().int(),
})

export interface CreateReturnResult {
  returnId: string
  totalCents: number
}

/**
 * Registers a return through the `create_return` security-definer RPC. The
 * server validates each quantity against sold minus already-returned units,
 * so a tampered client-side quantity can never be accepted.
 */
export async function createReturn(
  saleId: string,
  items: ReturnItemPayload[],
  reason: string,
): Promise<CreateReturnResult> {
  const { data, error } = await getSupabaseClient().rpc('create_return', {
    p_sale_id: saleId,
    p_items: items.map((item) => ({ sale_item_id: item.saleItemId, quantity: item.quantity })),
    p_reason: reason || null,
  })

  const result = parseRpcResult(createReturnResultSchema, data, error, 'No se pudo registrar la devolución.')
  return { returnId: result.return_id, totalCents: result.total_cents }
}
