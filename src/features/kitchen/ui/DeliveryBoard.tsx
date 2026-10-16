import { useCallback, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import { cn } from '../../../shared/ui/cn'
import { STATION_LABELS, ticketKey, type DeliverySource, type KitchenOrder, type KitchenStation } from '../domain/kitchen'
import { OrderTicketCard } from './OrderTicketCard'
import { useOrderBoard } from './useOrderBoard'

type DeliverySection = KitchenStation | 'other'

const SECTIONS: { value: DeliverySection; label: string }[] = [
  { value: 'pizza', label: STATION_LABELS.pizza },
  { value: 'grill', label: STATION_LABELS.grill },
  { value: 'other', label: 'Bebidas y otros' },
]

/** Keeps only the lines of one section; orders with none of them are dropped. */
function inSection(orders: KitchenOrder[], section: DeliverySection): KitchenOrder[] {
  return orders
    .map((order) => ({ ...order, lines: order.lines.filter((line) => (line.station ?? 'other') === section) }))
    .filter((order) => order.lines.length > 0)
}

interface DeliveryBoardProps {
  source: DeliverySource
  /** Shows one section (pizzas, grill, others) at a time, chosen with buttons; otherwise every line together. */
  sectioned?: boolean
  pollIntervalMs?: number
}

/** Delivery board: shows orders ready (reloaded on the realtime signal, polled as fallback) to hand over and lets staff mark each one delivered. */
export function DeliveryBoard({ source, sectioned = false, pollIntervalMs }: DeliveryBoardProps) {
  const list = useCallback(() => source.listReadyOrders(), [source])
  const act = useCallback((orderId: string, lineIds: string[]) => source.markDelivered(orderId, lineIds), [source])
  const { orders, error, pendingIds, reload, runAction } = useOrderBoard({ list, act, subscribe: source.subscribe, pollIntervalMs })
  const [section, setSection] = useState<DeliverySection>('pizza')
  const shown = orders && sectioned ? inSection(orders, section) : orders

  return (
    <section aria-label="Entrega de pedidos" className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-900">Entrega</h2>
        <Button variant="secondary" onClick={() => void reload()}>
          Actualizar
        </Button>
      </div>
      {sectioned && (
        <div className="flex flex-wrap gap-2">
          {SECTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={section === option.value}
              onClick={() => setSection(option.value)}
              className={cn(
                'rounded-xl px-5 py-3 text-base font-semibold transition-colors',
                section === option.value ? 'bg-red-700 text-white' : 'bg-slate-200 text-slate-800 hover:bg-slate-300',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      {error && <ErrorBanner message={error} />}
      {shown === null ? (
        !error && <Spinner label="Cargando pedidos…" />
      ) : shown.length === 0 ? (
        <p className="p-8 text-center text-lg text-slate-500">Sin pedidos listos para entregar</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((order) => (
            <OrderTicketCard
              key={ticketKey(order)}
              order={order}
              actionLabel="Marcar pedido entregado"
              actionContent="Entregado"
              actionClassName="bg-red-700 text-xl hover:bg-red-800 active:bg-red-900"
              pending={pendingIds.has(ticketKey(order))}
              onAction={() => void runAction(order)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
