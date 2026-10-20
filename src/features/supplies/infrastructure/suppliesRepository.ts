import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { parseRpcResult } from '../../../shared/supabase/rpc'
import { SUPPLY_UNITS, type Supply, type SupplyFormValues, type SupplyPurchase } from '../domain/supply'

/** numeric columns reach the client as numbers or strings depending on the path. */
const numeric = z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite())

export async function listSupplies(): Promise<Supply[]> {
  const { data, error } = await getSupabaseClient()
    .from('supplies')
    .select('id, name, unit, stock, stock_min, active')
    .order('name', { ascending: true })

  if (error) throw new Error('No se pudieron cargar los insumos.')

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    unit: row.unit as Supply['unit'],
    stock: Number(row.stock),
    stockMin: Number(row.stock_min),
    active: row.active,
  }))
}

export async function createSupply(values: SupplyFormValues): Promise<void> {
  const { error } = await getSupabaseClient().from('supplies').insert({
    name: values.name,
    unit: values.unit,
    stock_min: values.stockMin,
    active: values.active,
  })
  if (error) throw new Error('No se pudo crear el insumo.')
}

export async function updateSupply(id: string, values: SupplyFormValues): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('supplies')
    .update({
      name: values.name,
      unit: values.unit,
      stock_min: values.stockMin,
      active: values.active,
    })
    .eq('id', id)
  if (error) throw new Error('No se pudo actualizar el insumo.')
}

const supplyStockResultSchema = z
  .object({ supply_id: z.string(), stock: numeric })
  .transform((row) => ({ supplyId: row.supply_id, stock: row.stock }))

export interface SupplyStockResult {
  supplyId: string
  stock: number
}

/** Adds the received quantity to the stock and records what was paid (admin only). */
export async function recordPurchase(supplyId: string, quantity: number, costCents: number): Promise<SupplyStockResult> {
  const { data, error } = await getSupabaseClient().rpc('admin_record_supply_purchase', {
    p_supply_id: supplyId,
    p_quantity: quantity,
    p_cost_cents: costCents,
  })
  return parseRpcResult(supplyStockResultSchema, data, error, 'No se pudo registrar la compra.')
}

/** Sets the stock to the counted value (admin only). */
export async function countSupply(supplyId: string, counted: number): Promise<SupplyStockResult> {
  const { data, error } = await getSupabaseClient().rpc('admin_count_supply', {
    p_supply_id: supplyId,
    p_counted: counted,
  })
  return parseRpcResult(supplyStockResultSchema, data, error, 'No se pudo registrar el conteo.')
}

const purchasesSchema = z.array(
  z
    .object({
      id: z.string(),
      supply_id: z.string(),
      supply_name: z.string(),
      unit: z.enum(SUPPLY_UNITS),
      quantity: numeric,
      cost_cents: z.number().int(),
      created_by_name: z.string().nullable(),
      created_at: z.string(),
    })
    .transform(
      (row): SupplyPurchase => ({
        id: row.id,
        supplyId: row.supply_id,
        supplyName: row.supply_name,
        unit: row.unit,
        quantity: row.quantity,
        costCents: row.cost_cents,
        createdByName: row.created_by_name,
        createdAt: row.created_at,
      }),
    ),
)

/** Purchases in `[fromIso, toIso)`, newest first (admin only). */
export async function listPurchases(fromIso: string, toIso: string): Promise<SupplyPurchase[]> {
  const { data, error } = await getSupabaseClient().rpc('admin_list_supply_purchases', {
    p_from: fromIso,
    p_to: toIso,
  })
  return parseRpcResult(purchasesSchema, data, error, 'No se pudo cargar el historial de compras.')
}
