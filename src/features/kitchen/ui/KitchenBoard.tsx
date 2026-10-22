import { useCallback } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import { ticketKey, type KitchenSource } from '../domain/kitchen'
import { OrderTicketCard, WaitingTicketCard } from './OrderTicketCard'
import { useOrderBoard } from './useOrderBoard'

interface KitchenBoardProps {
  source: KitchenSource
  stationLabel: string
  pollIntervalMs?: number
}

/**
 * Station board: shows the pending tickets (reloaded on the realtime signal, polled as fallback), numbered in
 * arrival order, and lets the kitchen mark each one ready. Scheduled orders not in the queue yet are listed
 * below under "Programados", without turn number.
 */
export function KitchenBoard({ source, stationLabel, pollIntervalMs }: KitchenBoardProps) {
  const list = useCallback(() => source.listOrders(), [source])
  const act = useCallback((orderId: string, lineIds: string[]) => source.markReady(orderId, lineIds), [source])
  const { orders, error, pendingIds, reload, runAction } = useOrderBoard({ list, act, subscribe: source.subscribe, pollIntervalMs })
  const queue = orders?.filter((order) => !order.waiting) ?? []
  const waiting = orders?.filter((order) => order.waiting) ?? []

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
        <>
          {queue.length > 0 && (
            <ul aria-label="Cola" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {queue.map((order, index) => (
                <OrderTicketCard
                  key={ticketKey(order)}
                  order={order}
                  turn={index + 1}
                  textSize="large"
                  actionLabel="Marcar pedido listo"
                  actionContent="✓"
                  actionClassName="bg-emerald-700 text-3xl hover:bg-emerald-800 active:bg-emerald-900"
                  pending={pendingIds.has(ticketKey(order))}
                  onAction={() => void runAction(order)}
                />
              ))}
            </ul>
          )}
          {waiting.length > 0 && (
            <>
              <h3 className="text-lg font-bold text-slate-700">Programados</h3>
              <ul aria-label="Programados" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {waiting.map((order) => (
                  <WaitingTicketCard key={ticketKey(order)} order={order} textSize="large" />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}
