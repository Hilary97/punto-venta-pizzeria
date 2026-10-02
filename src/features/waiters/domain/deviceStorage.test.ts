import { describe, expect, it } from 'vitest'
import { clearDevice, DEVICE_STORAGE_KEY, loadDevice, saveDevice } from './deviceStorage'
import type { AuthorizedDevice } from './device'

function fakeStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  }
}

const device = (): AuthorizedDevice => ({
  deviceId: 'd1',
  name: 'Tablet barra',
  secret: 'a1'.repeat(32),
})

describe('deviceStorage', () => {
  it('uses the documented key', () => {
    expect(DEVICE_STORAGE_KEY).toBe('pizzeria.orderDevice')
  })

  it('returns null when nothing is stored', () => {
    expect(loadDevice(fakeStorage())).toBeNull()
  })

  it('round-trips a saved device', () => {
    const storage = fakeStorage()
    saveDevice(device(), storage)
    expect(loadDevice(storage)).toEqual(device())
  })

  it('returns null and clears malformed JSON', () => {
    const storage = fakeStorage()
    storage.setItem(DEVICE_STORAGE_KEY, '{oops')
    expect(loadDevice(storage)).toBeNull()
    expect(storage.getItem(DEVICE_STORAGE_KEY)).toBeNull()
  })

  it('returns null and clears a wrong shape', () => {
    const storage = fakeStorage()
    storage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({ deviceId: 1 }))
    expect(loadDevice(storage)).toBeNull()
    expect(storage.getItem(DEVICE_STORAGE_KEY)).toBeNull()
  })

  it.each(['short', 'z'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)])(
    'returns null and clears a secret that is not 64 hex chars (%s)',
    (secret) => {
      const storage = fakeStorage()
      saveDevice({ ...device(), secret }, storage)
      expect(loadDevice(storage)).toBeNull()
      expect(storage.getItem(DEVICE_STORAGE_KEY)).toBeNull()
    },
  )

  it('clearDevice removes the device', () => {
    const storage = fakeStorage()
    saveDevice(device(), storage)
    clearDevice(storage)
    expect(loadDevice(storage)).toBeNull()
  })
})
