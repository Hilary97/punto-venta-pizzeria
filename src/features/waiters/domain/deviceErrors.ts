import { toUserMessage } from '../../../shared/errors'

/** Part of the server message for a revoked, unknown or missing device secret. */
const REVOKED_MARKER = 'no está autorizado'

/** Whether the server rejected this device (revoked, unknown or missing secret). */
export function isRevokedDeviceError(error: unknown): boolean {
  return toUserMessage(error).includes(REVOKED_MARKER)
}

/** Whether a call failed because the waiter shift is missing or expired (server and client messages). */
export function isShiftError(error: unknown): boolean {
  const message = toUserMessage(error)
  return message.includes('turno') || message.includes('PIN')
}

/**
 * Returns a wrapper for async calls that reports an error matching `match` through `onMatch`
 * and then rethrows it, so the caller still sees the failure.
 */
export function reportingErrors(match: (error: unknown) => boolean, onMatch: () => void) {
  return <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await call(...args)
      } catch (error) {
        if (match(error)) onMatch()
        throw error
      }
    }
}
