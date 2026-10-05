import { useCallback } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import type { KitchenSource } from '../domain/kitchen'
import { OrderTicketCard } from './OrderTicketCard'
import { POLL_INTERVAL_MS, useOrderBoard } from './useOrderBoard'

interface KitchenBoardProps {
  source: KitchenSource
  stationLabel: string
  pollIntervalMs?: number
}

/** Station board: polls the pending orders and lets the kitchen mark each one ready. */
export function KitchenBoard({ source, stationLabel, pollIntervalMs = POLL_INTERVAL_MS }: KitchenBoardProps) {
  const list = useCallback(() => source.listOrders(), [source])
  const act = useCallback((orderId: string, lineIds: string[]) => source.markReady(orderId, lineIds), [source])
  const { orders, error, pendingIds, reload, runAction } = useOrderBoard({ list, act, pollIntervalMs })

  return (
    <section aria-label={`Cocina ${stationLabel}`} className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-900">{stationLabel}</h2>
        <Button variant="secondary" onClick={() => void reload()}>
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
            <OrderTicketCard
              key={order.id}
              order={order}
              actionLabel="Marcar pedido listo"
              actionContent="✓"
              actionClassName="bg-emerald-700 text-3xl hover:bg-emerald-800 active:bg-emerald-900"
              pending={pendingIds.has(order.id)}
              onAction={() => void runAction(order.id, order.lines.map((line) => line.id))}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
