import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChangeSignal } from './useChangeSignal'

function fakeSubscribe() {
  let notify: (() => void) | null = null
  const unsubscribe = vi.fn()
  const subscribe = vi.fn((onChange: () => void) => {
    notify = onChange
    return unsubscribe
  })
  return { subscribe, unsubscribe, signal: () => notify!() }
}

describe('useChangeSignal', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('calls onChange once, 300 ms after a burst of signals', () => {
    const { subscribe, signal } = fakeSubscribe()
    const onChange = vi.fn()
    renderHook(() => useChangeSignal(subscribe, onChange))
    act(() => {
      signal()
      signal()
      signal()
    })
    act(() => { vi.advanceTimersByTime(299) })
    expect(onChange).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('still calls onChange during a steady stream of signals', () => {
    const { subscribe, signal } = fakeSubscribe()
    const onChange = vi.fn()
    renderHook(() => useChangeSignal(subscribe, onChange))
    for (let i = 0; i < 10; i++) {
      act(() => signal())
      act(() => { vi.advanceTimersByTime(200) })
    }
    expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(5)
  })

  it('uses the latest onChange without resubscribing', () => {
    const { subscribe, signal } = fakeSubscribe()
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ onChange }) => useChangeSignal(subscribe, onChange), {
      initialProps: { onChange: first },
    })
    rerender({ onChange: second })
    act(() => signal())
    act(() => { vi.advanceTimersByTime(300) })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes and drops a pending call on unmount', () => {
    const { subscribe, unsubscribe, signal } = fakeSubscribe()
    const onChange = vi.fn()
    const { unmount } = renderHook(() => useChangeSignal(subscribe, onChange))
    act(() => signal())
    unmount()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does nothing without a subscription or when subscribing fails', () => {
    const onChange = vi.fn()
    expect(() => renderHook(() => useChangeSignal(undefined, onChange))).not.toThrow()
    const failing = vi.fn(() => {
      throw new Error('sin realtime')
    })
    expect(() => renderHook(() => useChangeSignal(failing, onChange))).not.toThrow()
    expect(onChange).not.toHaveBeenCalled()
  })
})
