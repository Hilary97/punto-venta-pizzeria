import type { RealtimeChannel } from '@supabase/supabase-js'
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
    token: z.number().int().nullable().default(null),
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
          station: z.enum(['pizza', 'grill']).nullable().default(null),
        }),
      )
      .nullable(),
  }),
)

function mapKitchenOrders(rows: z.infer<typeof kitchenOrdersSchema>): KitchenOrder[] {
  return rows.map((row) => ({
    id: row.id,
    token: row.token,
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
      station: line.station,
    })),
  }))
}

/** Public Broadcast channel the database signals on every order change (no payload). */
const KITCHEN_CHANNEL = 'kitchen'
const CHANGED_EVENT = 'changed'

const changeListeners = new Set<() => void>()
let kitchenChannel: RealtimeChannel | null = null

function notifyChangeListeners() {
  for (const listener of [...changeListeners]) listener()
}

/**
 * Listens for the database's order-change signal on one channel shared by every board.
 * Also notifies when the channel (re)subscribes, so changes missed while offline are reloaded.
 *
 * The channel stays open for the app's lifetime: realtime-js hands back the same channel for a
 * topic while it is still leaving, so removing and re-creating it (e.g. switching station) would
 * leave the next board on a dead channel.
 */
export function subscribeKitchenChanges(onChange: () => void): () => void {
  if (!kitchenChannel) {
    kitchenChannel = getSupabaseClient()
      .channel(KITCHEN_CHANNEL)
      .on('broadcast', { event: CHANGED_EVENT }, notifyChangeListeners)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') notifyChangeListeners()
      })
  }
  changeListeners.add(onChange)
  return () => {
    changeListeners.delete(onChange)
  }
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

    subscribe: subscribeKitchenChanges,
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

    subscribe: subscribeKitchenChanges,
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

    async markDelivered(orderId, lineIds) {
      const shiftToken = requireShiftToken()
      const { data, error } = await getSupabaseClient().rpc('device_mark_delivered', {
        p_device_secret: secret,
        p_shift_token: shiftToken,
        p_order_id: orderId,
        p_line_ids: lineIds,
      })
      return parseRpcResult(orderIdResultSchema, data, error, DELIVERED_ERROR).order_id
    },

    subscribe: subscribeKitchenChanges,
  }
}

export const authenticatedDeliverySource: DeliverySource = {
  async listReadyOrders() {
    const { data, error } = await getSupabaseClient().rpc('list_ready_orders')
    return mapKitchenOrders(parseRpcResult(kitchenOrdersSchema, data, error, LOAD_ERROR))
  },

  async markDelivered(orderId, lineIds) {
    const { data, error } = await getSupabaseClient().rpc('mark_delivered', {
      p_order_id: orderId,
      p_line_ids: lineIds,
    })
    return parseRpcResult(orderIdResultSchema, data, error, DELIVERED_ERROR).order_id
  },

  subscribe: subscribeKitchenChanges,
}
