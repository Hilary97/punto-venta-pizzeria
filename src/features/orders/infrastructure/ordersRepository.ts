import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { parseRpcResult } from '../../../shared/supabase/rpc'
import { pizzaConfigSchema, toRpcPizzaConfig } from '../../pizza/infrastructure/pizzaRepository'
import type { Order, OrderItemPayload } from '../domain/order'
import type { OrderQuote } from '../domain/orderQuote'

export const orderRowSchema = z.object({
  id: z.string(),
  table_number: z.number().int().nullable(),
  customer_name: z.string().nullable(),
  status: z.enum(['open', 'paid', 'cancelled']),
  created_at: z.string(),
  waiter_name: z.string().nullable(),
  notes: z.string().nullable(),
  order_items: z.array(
    z.object({
      id: z.string(),
      product_id: z.string().nullable(),
      product_name: z.string(),
      quantity: z.number().int(),
      item_type: z.enum(['product', 'pizza']),
      pizza: pizzaConfigSchema.nullable(),
      notes: z.string().nullable(),
      variant: z.string().nullable().default(null),
      station: z.enum(['pizza', 'grill']).nullable().default(null),
      ready_at: z.string().nullable().default(null),
      delivered_at: z.string().nullable().default(null),
    }),
  ),
})

const ORDER_SELECT = 'id, table_number, customer_name, status, created_at, waiter_name, notes, order_items(id, product_id, product_name, quantity, item_type, pizza, notes, variant, station, ready_at, delivered_at)'

export function mapOrderRow(row: z.infer<typeof orderRowSchema>): Order {
  return {
    id: row.id,
    tableNumber: row.table_number,
    customerName: row.customer_name,
    status: row.status,
    createdAt: row.created_at,
    waiterName: row.waiter_name,
    notes: row.notes,
    items: row.order_items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product_name,
      quantity: item.quantity,
      type: item.item_type,
      pizza: item.pizza,
      notes: item.notes,
      variant: item.variant,
      station: item.station,
      readyAt: item.ready_at,
      deliveredAt: item.delivered_at,
    })),
  }
}

/** Maps payload lines to the jsonb elements `insert_order_lines` expects. */
export function toRpcItems(items: OrderItemPayload[]) {
  return items.map((item) => {
    const notes = item.notes ?? null
    if (item.type === 'pizza') {
      return { type: 'pizza', pizza: toRpcPizzaConfig(item.pizza), quantity: item.quantity, notes }
    }
    const variant = item.variant ?? null
    return {
      type: 'product',
      product_id: item.productId,
      quantity: item.quantity,
      notes,
      ...(variant === null ? {} : { variant }),
    }
  })
}

/** Open orders, oldest first. Visible to every signed-in user (RLS). */
export async function listOpenOrders(): Promise<Order[]> {
  const { data, error } = await getSupabaseClient()
    .from('orders')
    .select(ORDER_SELECT)
    .eq('status', 'open')
    .order('created_at', { ascending: true })

  if (error) throw new Error('No se pudieron cargar los pedidos.')
  const parsed = z.array(orderRowSchema).safeParse(data)
  if (!parsed.success) throw new Error('No se pudieron cargar los pedidos.')
  return parsed.data.map(mapOrderRow)
}

/** A single order by id, or null when it does not exist or is not visible to the user. */
export async function getOrder(orderId: string): Promise<Order | null> {
  const { data, error } = await getSupabaseClient()
    .from('orders')
    .select(ORDER_SELECT)
    .eq('id', orderId)
    .maybeSingle()

  if (error) throw new Error('No se pudo cargar el pedido.')
  if (!data) return null
  const parsed = orderRowSchema.safeParse(data)
  if (!parsed.success) throw new Error('No se pudo cargar el pedido.')
  return mapOrderRow(parsed.data)
}

export const orderIdResultSchema = z.object({
  order_id: z.string(),
})

/**
 * Creates an open order through the `create_order` security-definer RPC.
 * Only product ids, pizza configurations, quantities and notes are sent; the
 * server snapshots names and never stores prices. Returns the new order id.
 */
export async function createOrder(
  tableNumber: number | null,
  customerName: string | null,
  items: OrderItemPayload[],
  notes: string | null = null,
): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc('create_order', {
    p_table_number: tableNumber,
    p_customer_name: customerName,
    p_items: toRpcItems(items),
    p_notes: notes,
  })
  return parseRpcResult(orderIdResultSchema, data, error, 'No se pudo crear el pedido.').order_id
}

/** Adds items to an open order; quantities of existing products are summed. Returns the order id. */
export async function addOrderItems(orderId: string, items: OrderItemPayload[]): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc('add_order_items', {
    p_order_id: orderId,
    p_items: toRpcItems(items),
  })
  return parseRpcResult(orderIdResultSchema, data, error, 'No se pudo agregar al pedido.').order_id
}

/** Cancels an open order. Returns the order id. */
export async function cancelOrder(orderId: string): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc('cancel_order', { p_order_id: orderId })
  return parseRpcResult(orderIdResultSchema, data, error, 'No se pudo cancelar el pedido.').order_id
}

/** Sets or clears (`null`) the order-level note of an open order. Returns the order id. */
export async function setOrderNotes(orderId: string, notes: string | null): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc('set_order_notes', {
    p_order_id: orderId,
    p_notes: notes,
  })
  return parseRpcResult(orderIdResultSchema, data, error, 'No se pudo guardar la nota.').order_id
}

const quoteLineSchema = z.object({
  order_item_id: z.string(),
  item_type: z.enum(['product', 'pizza']),
  name: z.string(),
  notes: z.string().nullable(),
  quantity: z.number().int(),
  unit_price_cents: z.number().int().nullable(),
  line_total_cents: z.number().int().nullable(),
  available: z.boolean(),
  reason: z.string().nullable(),
})

const orderQuoteSchema = z.object({
  order_id: z.string(),
  status: z.enum(['open', 'paid', 'cancelled']),
  lines: z.array(quoteLineSchema),
  total_cents: z.number().int(),
  payable: z.boolean(),
})

/** Prices an order at current catalog prices without charging it. Not available to waiters. */
export async function quoteOrder(orderId: string): Promise<OrderQuote> {
  const { data, error } = await getSupabaseClient().rpc('quote_order', { p_order_id: orderId })
  const result = parseRpcResult(orderQuoteSchema, data, error, 'No se pudo calcular el pedido.')

  return {
    orderId: result.order_id,
    status: result.status,
    totalCents: result.total_cents,
    payable: result.payable,
    lines: result.lines.map((line) => ({
      orderItemId: line.order_item_id,
      itemType: line.item_type,
      name: line.name,
      notes: line.notes,
      quantity: line.quantity,
      unitPriceCents: line.unit_price_cents,
      lineTotalCents: line.line_total_cents,
      available: line.available,
      reason: line.reason,
    })),
  }
}

const payOrderResultSchema = z.object({
  sale_id: z.string(),
  total_cents: z.number().int(),
  change_cents: z.number().int(),
  order_id: z.string(),
})

export interface PayOrderResult {
  saleId: string
  totalCents: number
  changeCents: number
  orderId: string
}

/**
 * Charges an open order through the `pay_order` RPC, which prices every line
 * (products and pizzas) server-side at payment time and writes the sale itself.
 * Not available to waiters.
 */
export async function payOrder(orderId: string, receivedCents: number): Promise<PayOrderResult> {
  const { data, error } = await getSupabaseClient().rpc('pay_order', {
    p_order_id: orderId,
    p_received_cents: receivedCents,
  })
  const result = parseRpcResult(payOrderResultSchema, data, error, 'No se pudo cobrar el pedido.')

  return {
    saleId: result.sale_id,
    totalCents: result.total_cents,
    changeCents: result.change_cents,
    orderId: result.order_id,
  }
}
