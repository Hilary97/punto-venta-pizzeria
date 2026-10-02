/** This device's authorization, kept in local storage. The secret never leaves the device except in RPC calls. */
export interface AuthorizedDevice {
  deviceId: string
  name: string
  secret: string
}

export interface AdminDevice {
  id: string
  name: string
  createdAt: string
  lastSeenAt: string | null
  revoked: boolean
}
