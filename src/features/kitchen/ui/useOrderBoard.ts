import { useCallback, useEffect, useRef, useState } from 'react'
import { toUserMessage } from '../../../shared/errors'
import type { KitchenOrder } from '../domain/kitchen'

export const POLL_INTERVAL_MS = 10_000

function byOldest(a: KitchenOrder, b: KitchenOrder): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
}

interface OrderBoardOptions {
  list: () => Promise<KitchenOrder[]>
  /** Per-order action (mark ready / delivered); the card is removed once it resolves. */
  act: (orderId: string) => Promise<unknown>
  pollIntervalMs: number
}

/** Polls a list of orders (oldest first) and runs a per-order action with optimistic removal. */
export function useOrderBoard({ list, act, pollIntervalMs }: OrderBoardOptions) {
  const [orders, setOrders] = useState<KitchenOrder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const mounted = useRef(true)

  const load = useCallback(async () => {
    try {
      const loaded = await list()
      if (!mounted.current) return
      setOrders([...loaded].sort(byOldest))
      setError(null)
    } catch (e) {
      if (mounted.current) setError(toUserMessage(e))
    }
  }, [list])

  useEffect(() => {
    mounted.current = true
    void load()
    const timer = setInterval(() => void load(), pollIntervalMs)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [load, pollIntervalMs])

  async function runAction(orderId: string) {
    if (pendingIds.has(orderId)) return
    setPendingIds((ids) => new Set(ids).add(orderId))
    setError(null)
    try {
      await act(orderId)
      if (mounted.current) setOrders((current) => current?.filter((o) => o.id !== orderId) ?? null)
    } catch (e) {
      if (mounted.current) {
        await load()
        setError(toUserMessage(e))
      }
    } finally {
      if (mounted.current) {
        setPendingIds((ids) => {
          const next = new Set(ids)
          next.delete(orderId)
          return next
        })
      }
    }
  }

  return { orders, error, pendingIds, reload: load, runAction }
}
