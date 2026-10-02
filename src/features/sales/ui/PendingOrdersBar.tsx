import { useEffect, useState } from 'react'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { toUserMessage } from '../../../shared/errors'
import { orderLabel, type Order } from '../../orders/domain/order'
import { listOpenOrders } from '../../orders/infrastructure/ordersRepository'

interface PendingOrdersBarProps {
  onCharge: (orderId: string) => void
}

export function PendingOrdersBar({ onCharge }: PendingOrdersBarProps) {
  const [orders, setOrders] = useState<Order[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    async function load() {
      try {
        const loaded = await listOpenOrders()
        if (cancelled) return
        setOrders(loaded)
        setError(null)
      } catch (loadError) {
        if (!cancelled) setError(toUserMessage(loadError))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    let cancelled = false
    void load()
    return () => {
      cancelled = true
    }
  }, [reloadCount])

  return (
    <section aria-label="Pedidos pendientes" className="mb-4 flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">{`Pedidos pendientes (${orders.length})`}</h2>
        <button
          type="button"
          disabled={isLoading}
          onClick={() => {
            setIsLoading(true)
            setReloadCount((count) => count + 1)
          }}
          className="text-sm font-semibold text-emerald-700 underline hover:text-emerald-800 disabled:opacity-50"
        >
          Actualizar
        </button>
      </div>
      {error && <ErrorBanner message={error} />}
      {orders.length === 0 && !error && !isLoading && <p className="text-sm text-slate-500">Sin pedidos pendientes</p>}
      {orders.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {orders.map((order) => {
            const label = orderLabel(order)
            const count = order.items.reduce((sum, item) => sum + item.quantity, 0)
            return (
              <li key={order.id} className="flex shrink-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="max-w-40 truncate font-semibold text-slate-900">{label}</span>
                  <span className="text-xs text-slate-500">{count === 1 ? '1 producto' : `${count} productos`}</span>
                </div>
                <button
                  type="button"
                  aria-label={`Cobrar pedido ${label}`}
                  onClick={() => onCharge(order.id)}
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800"
                >
                  Cobrar
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
