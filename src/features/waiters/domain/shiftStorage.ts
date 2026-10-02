import { z } from 'zod'
import { isShiftExpired, type WaiterShift } from './waiter'

export const SHIFT_STORAGE_KEY = 'pizzeria.waiterShift'

const shiftSchema = z.object({
  token: z.string().min(1),
  waiterId: z.string().min(1),
  fullName: z.string().min(1),
  expiresAt: z.string().min(1),
})

export function saveShift(shift: WaiterShift, storage: Storage = localStorage): void {
  storage.setItem(SHIFT_STORAGE_KEY, JSON.stringify(shift))
}

export function clearShift(storage: Storage = localStorage): void {
  storage.removeItem(SHIFT_STORAGE_KEY)
}

/** The shift saved on this device, or null (clearing it) when missing, invalid or expired. */
export function loadShift(storage: Storage = localStorage): WaiterShift | null {
  const raw = storage.getItem(SHIFT_STORAGE_KEY)
  if (raw === null) return null

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    clearShift(storage)
    return null
  }

  const parsed = shiftSchema.safeParse(json)
  if (!parsed.success || isShiftExpired(parsed.data)) {
    clearShift(storage)
    return null
  }
  return parsed.data
}
