import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { parseRpcResult } from '../../../shared/supabase/rpc'
import type { DeviceKind } from '../../kitchen/domain/kitchen'
import type { AdminDevice, AuthorizedDevice } from '../domain/device'
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

const deviceKindSchema = z.enum(['waiter', 'kitchen_pizza', 'kitchen_grill']).default('waiter')

const deviceInfoSchema = z.object({ device_id: z.string(), name: z.string(), kind: deviceKindSchema })

const adminDeviceListSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    kind: deviceKindSchema,
    created_at: z.string(),
    last_seen_at: z.string().nullable(),
    revoked: z.boolean(),
  }),
)

const registerDeviceResultSchema = z.object({
  device_id: z.string(),
  name: z.string(),
  kind: deviceKindSchema,
  device_secret: z.string(),
})

const deviceIdResultSchema = z.object({ device_id: z.string() })

const deletedWaiterResultSchema = z.object({ deleted_waiter_id: z.string() })

const deletedDeviceResultSchema = z.object({ deleted_device_id: z.string() })

/** Identity of the device behind a secret; throws when the secret is unknown or revoked. */
export async function deviceInfo(secret: string): Promise<{ deviceId: string; name: string; kind: DeviceKind }> {
  const { data, error } = await getSupabaseClient().rpc('device_info', { p_device_secret: secret })
  const result = parseRpcResult(deviceInfoSchema, data, error, 'No se pudo verificar el dispositivo.')
  return { deviceId: result.device_id, name: result.name, kind: result.kind }
}

/** Active waiters for the name picker. */
export async function deviceListWaiters(secret: string): Promise<Waiter[]> {
  const { data, error } = await getSupabaseClient().rpc('device_list_waiters', {
    p_device_secret: secret,
  })
  const rows = parseRpcResult(waiterListSchema, data, error, 'No se pudieron cargar los meseros.')
  return rows.map((row) => ({ id: row.id, fullName: row.full_name }))
}

/**
 * Starts a shift. A wrong PIN or a lockout comes back from the RPC as
 * `{ error }` (so the attempt counter persists); it is rethrown here so the UI
 * can show the message.
 */
export async function deviceStartShift(
  secret: string,
  waiterId: string,
  pin: string,
): Promise<WaiterShift> {
  const { data, error } = await getSupabaseClient().rpc('device_start_shift', {
    p_device_secret: secret,
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

/** The shift for a token, or null when it is unknown, expired, from another device or inactive. */
export async function deviceGetShift(secret: string, token: string): Promise<WaiterShift | null> {
  const { data, error } = await getSupabaseClient().rpc('device_get_shift', {
    p_device_secret: secret,
    p_shift_token: token,
  })
  const result = parseRpcResult(getShiftResultSchema, data, error, 'No se pudo verificar el turno.')
  if (!result) return null

  return {
    token,
    waiterId: result.waiter_id,
    fullName: result.full_name,
    expiresAt: result.expires_at,
  }
}

export async function deviceEndShift(secret: string, token: string): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('device_end_shift', {
    p_device_secret: secret,
    p_shift_token: token,
  })
  parseRpcResult(endShiftResultSchema, data, error, 'No se pudo cerrar el turno.')
}

/** Authorizes a new device. The returned secret is shown by the server only this once. */
export async function adminRegisterDevice(
  name: string,
  kind: DeviceKind = 'waiter',
): Promise<AuthorizedDevice & { kind: DeviceKind }> {
  const { data, error } = await getSupabaseClient().rpc('admin_register_device', {
    p_name: name,
    p_kind: kind,
  })
  const result = parseRpcResult(
    registerDeviceResultSchema,
    data,
    error,
    'No se pudo autorizar el dispositivo.',
  )
  return { deviceId: result.device_id, name: result.name, kind: result.kind, secret: result.device_secret }
}

export async function adminListDevices(): Promise<(AdminDevice & { kind: DeviceKind })[]> {
  const { data, error } = await getSupabaseClient().rpc('admin_list_devices')
  const rows = parseRpcResult(adminDeviceListSchema, data, error, 'No se pudieron cargar los dispositivos.')
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revoked: row.revoked,
  }))
}

export async function adminRevokeDevice(id: string): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('admin_revoke_device', { p_device_id: id })
  parseRpcResult(deviceIdResultSchema, data, error, 'No se pudo revocar el dispositivo.')
}

/** Permanently deletes a revoked device; the server rejects devices that are still active. */
export async function adminDeleteDevice(id: string): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('admin_delete_device', { p_device_id: id })
  parseRpcResult(deletedDeviceResultSchema, data, error, 'No se pudo eliminar el dispositivo.')
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

/** Permanently deletes a waiter; orders keep the waiter name snapshot. */
export async function adminDeleteWaiter(id: string): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('admin_delete_waiter', { p_waiter_id: id })
  parseRpcResult(deletedWaiterResultSchema, data, error, 'No se pudo eliminar el mesero.')
}

export async function adminUnlockWaiter(id: string): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('admin_unlock_waiter', { p_waiter_id: id })
  parseRpcResult(waiterIdResultSchema, data, error, 'No se pudo desbloquear al mesero.')
}
