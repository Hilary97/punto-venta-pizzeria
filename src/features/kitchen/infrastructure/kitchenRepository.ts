import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { parseRpcResult } from '../../../shared/supabase/rpc'
import { orderIdResultSchema } from '../../orders/infrastructure/ordersRepository'
import { pizzaConfigSchema } from '../../pizza/infrastructure/pizzaRepository'
import type {
  DeliverySource,
  KitchenOrder,
  KitchenSource,
  KitchenStation,
} from '../domain/kitchen'

const kitchenOrdersSchema = z.array(
  z.object({
    id: z.string(),
    table_number: z.number().int().nullable(),
    customer_name: z.string().nullable(),
    waiter_name: z.string().nullable(),
    notes: z.string().nullable(),
    created_at: z.string(),
    lines: z
      .array(
        z.object({
          id: z.string(),
          product_name: z.string(),
          quantity: z.number().int(),
          item_type: z.enum(['product', 'pizza']),
          pizza: pizzaConfigSchema.nullable(),
          notes: z.string().nullable(),
          variant: z.string().nullable().default(null),
        }),
      )
      .nullable(),
  }),
)

function mapKitchenOrders(rows: z.infer<typeof kitchenOrdersSchema>): KitchenOrder[] {
  return rows.map((row) => ({
    id: row.id,
    tableNumber: row.table_number,
    customerName: row.customer_name,
    waiterName: row.waiter_name,
    notes: row.notes,
    createdAt: row.created_at,
    lines: (row.lines ?? []).map((line) => ({
      id: line.id,
      productName: line.product_name,
      quantity: line.quantity,
      type: line.item_type,
      pizza: line.pizza,
      notes: line.notes,
      variant: line.variant,
    })),
  }))
}

const LOAD_ERROR = 'No se pudieron cargar los pedidos.'
const READY_ERROR = 'No se pudo marcar el pedido como listo.'
const DELIVERED_ERROR = 'No se pudo marcar el pedido como entregado.'
const SHIFT_REQUIRED_MESSAGE = 'Ingresa tu PIN para entregar pedidos.'

/** Kitchen source for an authorized kitchen device; the device itself implies the station. */
export function createDeviceKitchenSource(secret: string): KitchenSource {
  return {
    async listOrders() {
      const { data, error } = await getSupabaseClient().rpc('device_list_kitchen_orders', {
        p_device_secret: secret,
      })
      return mapKitchenOrders(parseRpcResult(kitchenOrdersSchema, data, error, LOAD_ERROR))
    },

    async markReady(orderId, lineIds) {
      const { data, error } = await getSupabaseClient().rpc('device_mark_station_ready', {
        p_device_secret: secret,
        p_order_id: orderId,
        p_line_ids: lineIds,
      })
      return parseRpcResult(orderIdResultSchema, data, error, READY_ERROR).order_id
    },
  }
}

/** Kitchen source for a signed-in admin/cashier viewing one station. */
export function authenticatedKitchenSource(station: KitchenStation): KitchenSource {
  return {
    async listOrders() {
      const { data, error } = await getSupabaseClient().rpc('list_kitchen_orders', {
        p_station: station,
      })
      return mapKitchenOrders(parseRpcResult(kitchenOrdersSchema, data, error, LOAD_ERROR))
    },

    async markReady(orderId, lineIds) {
      const { data, error } = await getSupabaseClient().rpc('mark_station_ready', {
        p_order_id: orderId,
        p_station: station,
        p_line_ids: lineIds,
      })
      return parseRpcResult(orderIdResultSchema, data, error, READY_ERROR).order_id
    },
  }
}

/** Delivery source for a waiter device; both calls need the current shift token. */
export function createDeviceDeliverySource(
  secret: string,
  getShiftToken: () => string | null,
): DeliverySource {
  function requireShiftToken(): string {
    const token = getShiftToken()
    if (token === null) throw new Error(SHIFT_REQUIRED_MESSAGE)
    return token
  }

  return {
    async listReadyOrders() {
      const shiftToken = requireShiftToken()
      const { data, error } = await getSupabaseClient().rpc('device_list_ready_orders', {
        p_device_secret: secret,
        p_shift_token: shiftToken,
      })
      return mapKitchenOrders(parseRpcResult(kitchenOrdersSchema, data, error, LOAD_ERROR))
    },

    async markDelivered(orderId) {
      const shiftToken = requireShiftToken()
      const { data, error } = await getSupabaseClient().rpc('device_mark_delivered', {
        p_device_secret: secret,
        p_shift_token: shiftToken,
        p_order_id: orderId,
      })
      return parseRpcResult(orderIdResultSchema, data, error, DELIVERED_ERROR).order_id
    },
  }
}

export const authenticatedDeliverySource: DeliverySource = {
  async listReadyOrders() {
    const { data, error } = await getSupabaseClient().rpc('list_ready_orders')
    return mapKitchenOrders(parseRpcResult(kitchenOrdersSchema, data, error, LOAD_ERROR))
  },

  async markDelivered(orderId) {
    const { data, error } = await getSupabaseClient().rpc('mark_delivered', { p_order_id: orderId })
    return parseRpcResult(orderIdResultSchema, data, error, DELIVERED_ERROR).order_id
  },
}
