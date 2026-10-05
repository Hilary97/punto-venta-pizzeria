import { useCallback } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import type { DeliverySource } from '../domain/kitchen'
import { OrderTicketCard } from './OrderTicketCard'
import { POLL_INTERVAL_MS, useOrderBoard } from './useOrderBoard'

interface DeliveryBoardProps {
  source: DeliverySource
  pollIntervalMs?: number
}

/** Delivery board: polls orders ready to hand over and lets staff mark each one delivered. */
export function DeliveryBoard({ source, pollIntervalMs = POLL_INTERVAL_MS }: DeliveryBoardProps) {
  const list = useCallback(() => source.listReadyOrders(), [source])
  const act = useCallback((orderId: string, lineIds: string[]) => source.markDelivered(orderId, lineIds), [source])
  const { orders, error, pendingIds, reload, runAction } = useOrderBoard({ list, act, pollIntervalMs })

  return (
    <section aria-label="Entrega de pedidos" className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-900">Entrega</h2>
        <Button variant="secondary" onClick={() => void reload()}>
          Actualizar
        </Button>
      </div>
      {error && <ErrorBanner message={error} />}
      {orders === null ? (
        !error && <Spinner label="Cargando pedidos…" />
      ) : orders.length === 0 ? (
        <p className="p-8 text-center text-lg text-slate-500">Sin pedidos listos para entregar</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => (
            <OrderTicketCard
              key={order.id}
              order={order}
              actionLabel="Marcar pedido entregado"
              actionContent="Entregado"
              actionClassName="bg-red-700 text-xl hover:bg-red-800 active:bg-red-900"
              pending={pendingIds.has(order.id)}
              onAction={() => void runAction(order.id, order.lines.map((line) => line.id))}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
