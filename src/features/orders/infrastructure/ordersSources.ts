import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { parseRpcResult } from '../../../shared/supabase/rpc'
import { listCategories, listProducts } from '../../products/infrastructure/productsRepository'
import type { OrderItemPayload } from '../domain/order'
import type { OrdersCatalog, OrdersSource } from '../domain/ordersSource'
import {
  addOrderItems,
  cancelOrder,
  createOrder,
  listOpenOrders,
  mapOrderRow,
  orderIdResultSchema,
  orderRowSchema,
  toRpcItems,
} from './ordersRepository'

export const authenticatedOrdersSource: OrdersSource = {
  async loadCatalog() {
    const [categories, products] = await Promise.all([listCategories(), listProducts(true)])
    return { categories, products }
  },
  listOpenOrders,
  createOrder,
  addOrderItems,
  cancelOrder,
}

const catalogSchema = z.object({
  categories: z.array(z.object({ id: z.string(), name: z.string(), sort_order: z.number() })),
  products: z.array(z.object({ id: z.string(), name: z.string(), category_id: z.string() })),
})

const openOrdersSchema = z.array(orderRowSchema)

const SHIFT_REQUIRED_MESSAGE = 'Ingresa tu PIN para registrar pedidos.'

/** Orders source for an authorized device; writes need the current waiter shift token. */
export function createDeviceOrdersSource(
  secret: string,
  getShiftToken: () => string | null,
): OrdersSource {
  function requireShiftToken(): string {
    const token = getShiftToken()
    if (token === null) throw new Error(SHIFT_REQUIRED_MESSAGE)
    return token
  }

  return {
    async loadCatalog(): Promise<OrdersCatalog> {
      const { data, error } = await getSupabaseClient().rpc('device_list_catalog', {
        p_device_secret: secret,
      })
      const result = parseRpcResult(catalogSchema, data, error, 'No se pudo cargar el catálogo.')
      return {
        categories: result.categories.map((category) => ({
          id: category.id,
          name: category.name,
          sortOrder: category.sort_order,
        })),
        products: result.products.map((product) => ({
          id: product.id,
          name: product.name,
          categoryId: product.category_id,
          priceCents: 0,
          active: true,
        })),
      }
    },

    async listOpenOrders() {
      const { data, error } = await getSupabaseClient().rpc('device_list_open_orders', {
        p_device_secret: secret,
      })
      return parseRpcResult(openOrdersSchema, data, error, 'No se pudieron cargar los pedidos.').map(
        mapOrderRow,
      )
    },

    async createOrder(tableNumber, customerName, items: OrderItemPayload[]) {
      const shiftToken = requireShiftToken()
      const { data, error } = await getSupabaseClient().rpc('device_create_order', {
        p_device_secret: secret,
        p_shift_token: shiftToken,
        p_table_number: tableNumber,
        p_customer_name: customerName,
        p_items: toRpcItems(items),
      })
      return parseRpcResult(orderIdResultSchema, data, error, 'No se pudo crear el pedido.').order_id
    },

    async addOrderItems(orderId, items) {
      const shiftToken = requireShiftToken()
      const { data, error } = await getSupabaseClient().rpc('device_add_order_items', {
        p_device_secret: secret,
        p_shift_token: shiftToken,
        p_order_id: orderId,
        p_items: toRpcItems(items),
      })
      return parseRpcResult(orderIdResultSchema, data, error, 'No se pudo agregar al pedido.').order_id
    },

    async cancelOrder(orderId) {
      const shiftToken = requireShiftToken()
      const { data, error } = await getSupabaseClient().rpc('device_cancel_order', {
        p_device_secret: secret,
        p_shift_token: shiftToken,
        p_order_id: orderId,
      })
      return parseRpcResult(orderIdResultSchema, data, error, 'No se pudo cancelar el pedido.').order_id
    },
  }
}
