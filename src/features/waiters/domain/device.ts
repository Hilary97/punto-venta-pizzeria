import type { DeviceKind } from '../../kitchen/domain/kitchen'

export const DEVICE_KIND_LABELS: Record<DeviceKind, string> = {
  waiter: 'Mesero',
  kitchen_pizza: 'Cocina - Pizzas',
  kitchen_grill: 'Cocina - Hamburguesas y botanas',
}

/** This device's authorization, kept in local storage. The secret never leaves the device except in RPC calls. */
export interface AuthorizedDevice {
  deviceId: string
  name: string
  kind: DeviceKind
  secret: string
}

export interface AdminDevice {
  id: string
  name: string
  kind: DeviceKind
  createdAt: string
  lastSeenAt: string | null
  revoked: boolean
}
