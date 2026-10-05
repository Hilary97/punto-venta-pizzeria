import { useCallback, useEffect, useRef, useState } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import { orderLabel, productLineLabel } from '../../orders/domain/order'
import type { KitchenOrder, KitchenSource } from '../domain/kitchen'

const POLL_INTERVAL_MS = 10_000

interface KitchenBoardProps {
  source: KitchenSource
  stationLabel: string
  pollIntervalMs?: number
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function byOldest(a: KitchenOrder, b: KitchenOrder): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
}

/** Station board: polls the pending orders and lets the kitchen mark each one ready. */
export function KitchenBoard({ source, stationLabel, pollIntervalMs = POLL_INTERVAL_MS }: KitchenBoardProps) {
  const [orders, setOrders] = useState<KitchenOrder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const mounted = useRef(true)

  const load = useCallback(async () => {
    try {
      const list = await source.listOrders()
      if (!mounted.current) return
      setOrders([...list].sort(byOldest))
      setError(null)
    } catch (e) {
      if (mounted.current) setError(toUserMessage(e))
    }
  }, [source])

  useEffect(() => {
    mounted.current = true
    void load()
    const timer = setInterval(() => void load(), pollIntervalMs)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [load, pollIntervalMs])

  async function handleReady(orderId: string) {
    if (pendingIds.has(orderId)) return
    setPendingIds((ids) => new Set(ids).add(orderId))
    setError(null)
    try {
      await source.markReady(orderId)
      if (mounted.current) setOrders((list) => list?.filter((o) => o.id !== orderId) ?? null)
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

  return (
    <section aria-label={`Cocina ${stationLabel}`} className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-900">{stationLabel}</h2>
        <Button variant="secondary" onClick={() => void load()}>
          Actualizar
        </Button>
      </div>
      {error && <ErrorBanner message={error} />}
      {orders === null ? (
        !error && <Spinner label="Cargando pedidos…" />
      ) : orders.length === 0 ? (
        <p className="p-8 text-center text-lg text-slate-500">Sin pedidos en cocina</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => (
            <li key={order.id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 break-words text-2xl font-bold text-slate-900">{orderLabel(order)}</h3>
                <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-700">
                  {formatTime(order.createdAt)}
                </span>
              </div>
              {order.waiterName && <p className="text-sm text-slate-500">Atendió: {order.waiterName}</p>}
              <ul className="flex-1 space-y-2 text-lg text-slate-800">
                {order.lines.map((line) => (
                  <li key={line.id} className="break-words">
                    <span className="font-semibold">
                      {line.quantity} × {productLineLabel(line.productName, line.variant)}
                    </span>
                    {line.notes && (
                      <span className="mt-1 block rounded-lg bg-amber-100 px-2 py-1 text-base font-medium text-amber-900">
                        Nota: {line.notes}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {order.notes && (
                <p className="break-words rounded-lg bg-amber-100 px-3 py-2 text-base font-medium text-amber-900">
                  Nota del pedido: {order.notes}
                </p>
              )}
              <button
                type="button"
                aria-label="Marcar pedido listo"
                disabled={pendingIds.has(order.id)}
                onClick={() => void handleReady(order.id)}
                className="flex min-h-16 items-center justify-center rounded-xl bg-emerald-700 text-3xl font-bold text-white shadow-sm transition-colors hover:bg-emerald-800 active:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ✓
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
