import { useCallback, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import { cn } from '../../../shared/ui/cn'
import { STATION_LABELS, ticketKey, type DeliverySource, type KitchenOrder, type KitchenStation } from '../domain/kitchen'
import { OrderTicketCard } from './OrderTicketCard'
import { useOrderBoard } from './useOrderBoard'

/** Prepared drinks are picked up with the other drinks. */
type DeliverySection = Exclude<KitchenStation, 'drinks'> | 'other'

const SECTIONS: { value: DeliverySection; label: string }[] = [
  { value: 'pizza', label: STATION_LABELS.pizza },
  { value: 'grill', label: STATION_LABELS.grill },
  { value: 'other', label: 'Bebidas y otros' },
]

function sectionOf(station: KitchenStation | null | undefined): DeliverySection {
  return station === 'pizza' || station === 'grill' ? station : 'other'
}

/** Keeps only the lines of one section; orders with none of them are dropped. */
function inSection(orders: KitchenOrder[], section: DeliverySection): KitchenOrder[] {
  return orders
    .map((order) => ({ ...order, lines: order.lines.filter((line) => sectionOf(line.station) === section) }))
    .filter((order) => order.lines.length > 0)
}

/** Distinct tokens held by the given orders, in ascending order; orders without a token add none. */
function tokensOf(orders: KitchenOrder[]): number[] {
  const tokens = new Set(orders.flatMap((order) => (order.token === null ? [] : [order.token])))
  return [...tokens].sort((a, b) => a - b)
}

const chipClass = (selected: boolean) =>
  cn(
    'min-w-14 rounded-xl px-4 py-3 text-lg font-bold transition-colors',
    selected ? 'bg-red-700 text-white' : 'bg-slate-200 text-slate-800 hover:bg-slate-300',
  )

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
  const [selectedToken, setSelectedToken] = useState<number | null>(null)
  const visible = orders && sectioned ? inSection(orders, section) : orders
  const tokens = visible ? tokensOf(visible) : []
  // A token that was delivered or is absent from this section falls back to every order.
  const activeToken = selectedToken !== null && tokens.includes(selectedToken) ? selectedToken : null
  const shown = visible && (activeToken === null ? visible : visible.filter((order) => order.token === activeToken))

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
      {tokens.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-600">Buscar por ficha</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-label="Todas las fichas"
              aria-pressed={activeToken === null}
              onClick={() => setSelectedToken(null)}
              className={chipClass(activeToken === null)}
            >
              Todas
            </button>
            {tokens.map((token) => (
              <button
                key={token}
                type="button"
                aria-label={`Ficha ${token}`}
                aria-pressed={activeToken === token}
                onClick={() => setSelectedToken(activeToken === token ? null : token)}
                className={chipClass(activeToken === token)}
              >
                {token}
              </button>
            ))}
          </div>
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
