import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { toUserMessage } from '../../../shared/errors'
import { orderLabel, type Order } from '../../orders/domain/order'
import { listOpenOrders } from '../../orders/infrastructure/ordersRepository'

interface PendingOrdersPanelProps {
  onCharge: (orderId: string) => void
}

export function PendingOrdersPanel({ onCharge }: PendingOrdersPanelProps) {
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
    <section aria-label="Pedidos pendientes" className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-slate-900">{`Pedidos pendientes (${orders.length})`}</h2>
        <button
          type="button"
          disabled={isLoading}
          onClick={() => {
            setIsLoading(true)
            setReloadCount((count) => count + 1)
          }}
          className="min-h-11 px-2 text-sm font-semibold text-emerald-700 underline hover:text-emerald-800 disabled:opacity-50"
        >
          Actualizar
        </button>
      </div>
      {error && <ErrorBanner message={error} />}
      {orders.length === 0 && !error && !isLoading && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center">
          <p className="text-lg font-semibold text-slate-700">Sin pedidos pendientes</p>
          <p className="text-sm text-slate-500">Los pedidos se registran en Pedidos.</p>
          <Link to="/pedidos" className="font-semibold text-emerald-700 underline hover:text-emerald-800">
            Ir a Pedidos
          </Link>
        </div>
      )}
      {orders.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => {
            const label = orderLabel(order)
            return (
              <li key={order.id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <span className="break-words text-lg font-bold text-slate-900">{label}</span>
                <ul className="flex flex-1 flex-col gap-1 text-slate-700">
                  {order.items.map((item) => (
                    <li key={item.id} className="break-words">{`${item.productName} × ${item.quantity}`}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  aria-label={`Cobrar pedido ${label}`}
                  onClick={() => onCharge(order.id)}
                  className="min-h-12 rounded-lg bg-emerald-700 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-800"
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
