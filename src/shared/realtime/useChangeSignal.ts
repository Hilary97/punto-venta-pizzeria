import { useEffect, useRef } from 'react'

/** Calls `onChange` whenever orders may have changed; returns the function that stops listening. */
export type SubscribeChanges = (onChange: () => void) => () => void

/** A signal fires `onChange` after this delay; signals arriving meanwhile join that same call. */
const SIGNAL_DEBOUNCE_MS = 300

/**
 * Runs `onChange` on the realtime change signal, merging bursts into one call.
 * Does nothing without `subscribe` or when subscribing fails (the screen keeps working without realtime).
 */
export function useChangeSignal(subscribe: SubscribeChanges | undefined, onChange: () => void) {
  const latest = useRef(onChange)
  useEffect(() => {
    latest.current = onChange
  })

  useEffect(() => {
    if (!subscribe) return
    let debounce: ReturnType<typeof setTimeout> | undefined
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = subscribe(() => {
        // Not restarted by later signals, so a steady stream cannot postpone the call.
        if (debounce !== undefined) return
        debounce = setTimeout(() => {
          debounce = undefined
          latest.current()
        }, SIGNAL_DEBOUNCE_MS)
      })
    } catch {
      // No realtime (e.g. misconfigured client).
    }
    return () => {
      clearTimeout(debounce)
      unsubscribe?.()
    }
  }, [subscribe])
}
