import { useCallback, useEffect, useRef, useState } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { ticketKey, type KitchenOrder, type SubscribeChanges } from '../domain/kitchen'

/** Polling interval when the board has no realtime signal. */
export const POLL_INTERVAL_MS = 10_000
/** Fallback polling interval while the realtime signal drives the reloads. */
export const REALTIME_FALLBACK_POLL_MS = 60_000
/** A signal reloads after this delay; signals arriving meanwhile join that same reload. */
const SIGNAL_DEBOUNCE_MS = 300

function byOldest(a: KitchenOrder, b: KitchenOrder): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
}

interface OrderBoardOptions {
  list: () => Promise<KitchenOrder[]>
  /** Per-ticket action (mark ready / delivered) on the shown lines; the card is removed once it resolves. */
  act: (orderId: string, lineIds: string[]) => Promise<unknown>
  /** Realtime change signal; when present the board reloads on it and polls only as a fallback. */
  subscribe?: SubscribeChanges
  /** Overrides the polling interval chosen from `subscribe`. */
  pollIntervalMs?: number
}

/**
 * Loads a list of tickets (oldest first), reloading on the realtime signal or by polling,
 * and runs a per-ticket action with optimistic removal.
 */
export function useOrderBoard({ list, act, subscribe, pollIntervalMs }: OrderBoardOptions) {
  const [orders, setOrders] = useState<KitchenOrder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const mounted = useRef(true)
  const latestLoad = useRef(0)

  const load = useCallback(async () => {
    // Overlapping loads (signal, poll, button) may resolve out of order; keep only the newest.
    const loadId = ++latestLoad.current
    try {
      const loaded = await list()
      if (!mounted.current || loadId !== latestLoad.current) return
      setOrders([...loaded].sort(byOldest))
      setError(null)
    } catch (e) {
      if (mounted.current && loadId === latestLoad.current) setError(toUserMessage(e))
    }
  }, [list])

  useEffect(() => {
    mounted.current = true
    void load()

    let debounce: ReturnType<typeof setTimeout> | undefined
    let unsubscribe: (() => void) | undefined
    if (subscribe) {
      try {
        unsubscribe = subscribe(() => {
          // Not restarted by later signals, so a steady stream cannot postpone the reload.
          if (debounce !== undefined) return
          debounce = setTimeout(() => {
            debounce = undefined
            void load()
          }, SIGNAL_DEBOUNCE_MS)
        })
      } catch {
        // No realtime (e.g. misconfigured client): fall back to regular polling.
      }
    }
    const interval = pollIntervalMs ?? (unsubscribe ? REALTIME_FALLBACK_POLL_MS : POLL_INTERVAL_MS)
    const timer = setInterval(() => void load(), interval)
    return () => {
      mounted.current = false
      clearInterval(timer)
      clearTimeout(debounce)
      unsubscribe?.()
    }
  }, [load, subscribe, pollIntervalMs])

  async function runAction(order: KitchenOrder) {
    const key = ticketKey(order)
    if (pendingIds.has(key)) return
    setPendingIds((ids) => new Set(ids).add(key))
    setError(null)
    try {
      const acted = new Set(order.lines.map((line) => line.id))
      await act(order.id, [...acted])
      // Drop only the acted lines: a card may show part of a ticket (one delivery section).
      if (mounted.current) {
        setOrders(
          (current) =>
            current
              ?.map((o) => (ticketKey(o) === key ? { ...o, lines: o.lines.filter((line) => !acted.has(line.id)) } : o))
              .filter((o) => o.lines.length > 0) ?? null,
        )
      }
    } catch (e) {
      if (mounted.current) {
        await load()
        setError(toUserMessage(e))
      }
    } finally {
      if (mounted.current) {
        setPendingIds((ids) => {
          const next = new Set(ids)
          next.delete(key)
          return next
        })
      }
    }
  }

  return { orders, error, pendingIds, reload: load, runAction }
}
