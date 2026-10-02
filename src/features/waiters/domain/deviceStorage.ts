import { z } from 'zod'
import type { AuthorizedDevice } from './device'

export const DEVICE_STORAGE_KEY = 'pizzeria.orderDevice'

const deviceSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1),
  secret: z.string().regex(/^[0-9a-f]{64}$/i),
})

export function saveDevice(device: AuthorizedDevice, storage: Storage = localStorage): void {
  storage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(device))
}

export function clearDevice(storage: Storage = localStorage): void {
  storage.removeItem(DEVICE_STORAGE_KEY)
}

/** The device authorized on this browser, or null (clearing it) when missing or invalid. */
export function loadDevice(storage: Storage = localStorage): AuthorizedDevice | null {
  const raw = storage.getItem(DEVICE_STORAGE_KEY)
  if (raw === null) return null

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    clearDevice(storage)
    return null
  }

  const parsed = deviceSchema.safeParse(json)
  if (!parsed.success) {
    clearDevice(storage)
    return null
  }
  return parsed.data
}
