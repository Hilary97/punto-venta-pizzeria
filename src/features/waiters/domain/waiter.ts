export interface Waiter {
  id: string
  fullName: string
}

export interface AdminWaiter {
  id: string
  fullName: string
  active: boolean
  locked: boolean
  createdAt: string
}

export interface WaiterShift {
  token: string
  waiterId: string
  fullName: string
  expiresAt: string
}

export const PIN_LENGTH = 4

export const MAX_WAITER_NAME_LENGTH = 60

/** A PIN is valid when it is exactly 4 digits. */
export function isValidPin(pin: string): boolean {
  return new RegExp(`^[0-9]{${PIN_LENGTH}}$`).test(pin)
}

/** Trims the name and collapses any inner whitespace run into a single space. */
export function normalizeWaiterName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/** A waiter name is valid when it has 1..60 characters after normalizing. */
export function isValidWaiterName(raw: string): boolean {
  const length = normalizeWaiterName(raw).length
  return length >= 1 && length <= MAX_WAITER_NAME_LENGTH
}

/** A shift is expired at its expiry instant; an unparseable date counts as expired. */
export function isShiftExpired(shift: WaiterShift, now: Date = new Date()): boolean {
  const expiresAt = new Date(shift.expiresAt).getTime()
  return Number.isNaN(expiresAt) || expiresAt <= now.getTime()
}
