import { describe, expect, it, vi } from 'vitest'
import { isRevokedDeviceError, isShiftError, reportingErrors } from './deviceErrors'

describe('device errors', () => {
  it('recognizes a revoked or unknown device from the server message', () => {
    expect(isRevokedDeviceError(new Error('Este dispositivo no está autorizado.'))).toBe(true)
    expect(isRevokedDeviceError(new Error('Este dispositivo no está autorizado para pedidos.'))).toBe(true)
    expect(isRevokedDeviceError(new Error('Tu turno expiró. Ingresa tu PIN de nuevo.'))).toBe(false)
  })

  it('recognizes a missing or expired waiter shift from the server and client messages', () => {
    expect(isShiftError(new Error('Tu turno expiró. Ingresa tu PIN de nuevo.'))).toBe(true)
    expect(isShiftError(new Error('Ingresa tu PIN para entregar pedidos.'))).toBe(true)
    expect(isShiftError(new Error('Este dispositivo no está autorizado.'))).toBe(false)
  })

  it('reports a matching error before rethrowing it, and passes results and other errors through', async () => {
    const onMatch = vi.fn()
    const guard = reportingErrors(isRevokedDeviceError, onMatch)
    const revoked = new Error('Este dispositivo no está autorizado.')
    const other = new Error('boom')

    await expect(guard(async (n: number) => n * 2)(21)).resolves.toBe(42)
    await expect(guard(async () => Promise.reject(other))()).rejects.toBe(other)
    expect(onMatch).not.toHaveBeenCalled()
    await expect(guard(async () => Promise.reject(revoked))()).rejects.toBe(revoked)
    expect(onMatch).toHaveBeenCalledTimes(1)
  })
})
