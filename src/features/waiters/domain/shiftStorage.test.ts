import { describe, expect, it } from 'vitest'
import { clearShift, loadShift, saveShift, SHIFT_STORAGE_KEY } from './shiftStorage'
import type { WaiterShift } from './waiter'

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

const future = (): WaiterShift => ({
  token: 'tok',
  waiterId: 'w1',
  fullName: 'Ana',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
})

describe('shiftStorage', () => {
  it('uses the documented key', () => {
    expect(SHIFT_STORAGE_KEY).toBe('pizzeria.waiterShift')
  })

  it('returns null when nothing is stored', () => {
    expect(loadShift(fakeStorage())).toBeNull()
  })

  it('round-trips a saved shift', () => {
    const storage = fakeStorage()
    const shift = future()
    saveShift(shift, storage)
    expect(loadShift(storage)).toEqual(shift)
  })

  it('returns null and clears an expired shift', () => {
    const storage = fakeStorage()
    saveShift({ ...future(), expiresAt: new Date(Date.now() - 1000).toISOString() }, storage)
    expect(loadShift(storage)).toBeNull()
    expect(storage.getItem(SHIFT_STORAGE_KEY)).toBeNull()
  })

  it('returns null and clears malformed JSON', () => {
    const storage = fakeStorage()
    storage.setItem(SHIFT_STORAGE_KEY, '{oops')
    expect(loadShift(storage)).toBeNull()
    expect(storage.getItem(SHIFT_STORAGE_KEY)).toBeNull()
  })

  it('returns null and clears a wrong shape', () => {
    const storage = fakeStorage()
    storage.setItem(SHIFT_STORAGE_KEY, JSON.stringify({ token: 1 }))
    expect(loadShift(storage)).toBeNull()
    expect(storage.getItem(SHIFT_STORAGE_KEY)).toBeNull()
  })

  it('clearShift removes the shift', () => {
    const storage = fakeStorage()
    saveShift(future(), storage)
    clearShift(storage)
    expect(loadShift(storage)).toBeNull()
  })
})
