import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { parseRpcResult } from '../../../shared/supabase/rpc'
import type { AdminWaiter, Waiter, WaiterShift } from '../domain/waiter'

const waiterListSchema = z.array(z.object({ id: z.string(), full_name: z.string() }))

const adminWaiterListSchema = z.array(
  z.object({
    id: z.string(),
    full_name: z.string(),
    active: z.boolean(),
    locked: z.boolean(),
    created_at: z.string(),
  }),
)

const startShiftResultSchema = z.union([
  z.object({ error: z.string() }),
  z.object({
    token: z.string(),
    waiter_id: z.string(),
    full_name: z.string(),
    expires_at: z.string(),
  }),
])

const getShiftResultSchema = z
  .object({ waiter_id: z.string(), full_name: z.string(), expires_at: z.string() })
  .nullable()

const endShiftResultSchema = z.object({ ended: z.boolean() })

const waiterIdResultSchema = z.object({ waiter_id: z.string() })

/** Active waiters for the name picker. Visible to every signed-in user with a profile. */
export async function listActiveWaiters(): Promise<Waiter[]> {
  const { data, error } = await getSupabaseClient().rpc('list_active_waiters')
  const rows = parseRpcResult(waiterListSchema, data, error, 'No se pudieron cargar los meseros.')
  return rows.map((row) => ({ id: row.id, fullName: row.full_name }))
}

/**
 * Starts a shift. A wrong PIN or a lockout comes back from the RPC as
 * `{ error }` (so the attempt counter persists); it is rethrown here so the UI
 * can show the message.
 */
export async function startWaiterShift(waiterId: string, pin: string): Promise<WaiterShift> {
  const { data, error } = await getSupabaseClient().rpc('start_waiter_shift', {
    p_waiter_id: waiterId,
    p_pin: pin,
  })
  const result = parseRpcResult(startShiftResultSchema, data, error, 'No se pudo iniciar el turno.')
  if ('error' in result) throw new Error(result.error)

  return {
    token: result.token,
    waiterId: result.waiter_id,
    fullName: result.full_name,
    expiresAt: result.expires_at,
  }
}

export async function endWaiterShift(token: string): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('end_waiter_shift', { p_token: token })
  parseRpcResult(endShiftResultSchema, data, error, 'No se pudo cerrar el turno.')
}

/** The shift for a token, or null when it is unknown, expired, from another device or inactive. */
export async function getWaiterShift(token: string): Promise<WaiterShift | null> {
  const { data, error } = await getSupabaseClient().rpc('get_waiter_shift', { p_token: token })
  const result = parseRpcResult(getShiftResultSchema, data, error, 'No se pudo verificar el turno.')
  if (!result) return null

  return {
    token,
    waiterId: result.waiter_id,
    fullName: result.full_name,
    expiresAt: result.expires_at,
  }
}

export async function adminListWaiters(): Promise<AdminWaiter[]> {
  const { data, error } = await getSupabaseClient().rpc('admin_list_waiters')
  const rows = parseRpcResult(adminWaiterListSchema, data, error, 'No se pudieron cargar los meseros.')
  return rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    active: row.active,
    locked: row.locked,
    createdAt: row.created_at,
  }))
}

export async function adminCreateWaiter(fullName: string, pin: string): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('admin_create_waiter', {
    p_full_name: fullName,
    p_pin: pin,
  })
  parseRpcResult(waiterIdResultSchema, data, error, 'No se pudo crear el mesero.')
}

export async function adminUpdateWaiter(id: string, fullName: string, active: boolean): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('admin_update_waiter', {
    p_waiter_id: id,
    p_full_name: fullName,
    p_active: active,
  })
  parseRpcResult(waiterIdResultSchema, data, error, 'No se pudo actualizar el mesero.')
}

export async function adminResetWaiterPin(id: string, pin: string): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('admin_reset_waiter_pin', {
    p_waiter_id: id,
    p_pin: pin,
  })
  parseRpcResult(waiterIdResultSchema, data, error, 'No se pudo cambiar el PIN.')
}

export async function adminUnlockWaiter(id: string): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('admin_unlock_waiter', { p_waiter_id: id })
  parseRpcResult(waiterIdResultSchema, data, error, 'No se pudo desbloquear al mesero.')
}
