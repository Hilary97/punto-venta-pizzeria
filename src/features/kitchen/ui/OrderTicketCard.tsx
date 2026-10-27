import { useEffect, useState, type ReactNode } from 'react'
import { orderLabel, pickupTimeLabel, productLineLabel, tokenLabel } from '../../orders/domain/order'
import { ServiceBadge } from '../../orders/ui/ServiceBadge'
import { pizzaLabelLayout } from '../../pizza/domain/pizza'
import { PizzaLabelGroups } from '../../pizza/ui/PizzaLabelGroups'
import { delayLevel, pendingStationsLabel, type DelayLevel, type KitchenLine, type KitchenOrder } from '../domain/kitchen'

const DELAY_CLASSES: Record<DelayLevel, string> = {
  ok: 'border-slate-200 bg-white',
  warning: 'border-yellow-400 bg-yellow-100',
  late: 'border-red-500 bg-red-100',
}

/** Current time, refreshed every `intervalMs` so delay colours change while the board stays open. */
function useNow(intervalMs = 15_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Local time in 12-hour format, e.g. "3:05 pm". */
function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`
}

type TextSize = 'normal' | 'large'

const TEXT: Record<TextSize, { title: string; time: string; token: string; waiter: string; lines: string; note: string }> = {
  normal: { title: 'text-2xl', time: 'text-sm', token: 'text-xl', waiter: 'text-sm', lines: 'space-y-2 text-lg', note: 'text-base' },
  large: { title: 'text-3xl', time: 'text-base', token: 'text-2xl', waiter: 'text-base', lines: 'space-y-3 text-3xl leading-tight', note: 'text-xl' },
}

function LineList({ lines, size }: { lines: KitchenLine[]; size: TextSize }) {
  const text = TEXT[size]
  return (
    <ul className={`${text.lines} text-slate-800`}>
      {lines.map((line) => {
        const { title, groups } = pizzaLabelLayout(productLineLabel(line.productName, line.variant))
        return (
          <li key={line.id} className="break-words">
            <span className="font-semibold">
              {line.quantity} × {title}
            </span>
            {line.addedAt && (
              <span className={`ml-2 inline-block rounded-lg bg-sky-600 px-2 py-0.5 align-middle font-bold text-white ${text.note}`}>
                Agregado {formatTime(line.addedAt)}
              </span>
            )}
            <PizzaLabelGroups groups={groups} />
            {line.notes && (
              <span className={`mt-1 block rounded-lg bg-amber-100 px-2 py-1 font-medium text-amber-900 ${text.note}`}>
                Nota: {line.notes}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

interface OrderTicketCardProps {
  order: KitchenOrder
  /** Position in the station queue (1 = cook first); omitted on boards without a queue. */
  turn?: number
  /** `large` for the kitchen, where cooks read the ticket from a distance. */
  textSize?: TextSize
  actionLabel: string
  actionContent: ReactNode
  actionClassName: string
  pending: boolean
  onAction: () => void
}

interface WaitingTicketCardProps {
  order: KitchenOrder
  textSize?: TextSize
}

/** A scheduled order that has not entered the queue: informative only, no turn, token, delay colour or action. */
export function WaitingTicketCard({ order, textSize = 'normal' }: WaitingTicketCardProps) {
  const text = TEXT[textSize]
  return (
    <li data-delay="ok" className={`flex min-w-0 flex-col gap-3 rounded-xl border-2 border-dashed p-4 shadow-sm ${DELAY_CLASSES.ok}`}>
      <h3 className={`min-w-0 break-words font-bold text-slate-900 ${text.title}`}>{orderLabel(order)}</h3>
      <ServiceBadge service={order.service} className={text.token} />
      <p className={`self-start rounded-lg border-2 border-sky-500 bg-sky-50 px-3 py-1 font-bold text-sky-900 ${text.token}`}>
        Programado
      </p>
      {order.scheduledFor && <p className={`font-bold text-slate-700 ${text.waiter}`}>{pickupTimeLabel(order.scheduledFor)}</p>}
      {order.waiterName && <p className={`text-slate-500 ${text.waiter}`}>Atendió: {order.waiterName}</p>}
      <LineList lines={order.lines} size={textSize} />
      {order.notes && (
        <p className={`break-words rounded-lg bg-amber-100 px-3 py-2 font-medium text-amber-900 ${text.note}`}>
          Nota del pedido: {order.notes}
        </p>
      )}
    </li>
  )
}

/** Order ticket shared by the kitchen and delivery boards, with one big action button. */
export function OrderTicketCard({
  order,
  turn,
  textSize = 'normal',
  actionLabel,
  actionContent,
  actionClassName,
  pending,
  onAction,
}: OrderTicketCardProps) {
  const delay = delayLevel(order.createdAt, useNow())
  const text = TEXT[textSize]
  const missing = pendingStationsLabel(order.pendingStations)
  return (
    <li
      data-delay={delay}
      className={`flex min-w-0 flex-col gap-3 rounded-xl border-2 p-4 shadow-sm transition-colors ${DELAY_CLASSES[delay]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          {turn !== undefined && (
            <span
              aria-label={`Turno ${turn}`}
              className="shrink-0 rounded-lg bg-slate-900 px-3 py-1 text-3xl font-black text-white dark:text-slate-50"
            >
              #{turn}
            </span>
          )}
          <h3 className={`min-w-0 break-words font-bold text-slate-900 ${text.title}`}>{orderLabel(order)}</h3>
        </div>
        <span className={`shrink-0 rounded-lg bg-slate-100 px-2 py-1 font-semibold text-slate-700 ${text.time}`}>
          {formatTime(order.createdAt)}
        </span>
      </div>
      <ServiceBadge service={order.service} className={text.token} />
      <p className={`self-start rounded-lg border-2 border-amber-500 bg-amber-50 px-3 py-1 font-bold text-amber-900 ${text.token}`}>
        {tokenLabel(order.token)}
      </p>
      {order.scheduledFor && <p className={`font-bold text-slate-700 ${text.waiter}`}>{pickupTimeLabel(order.scheduledFor)}</p>}
      {order.waiterName && <p className={`text-slate-500 ${text.waiter}`}>Atendió: {order.waiterName}</p>}
      {missing && (
        <p className={`self-start rounded-lg border-2 border-sky-500 bg-sky-50 px-3 py-1 font-bold text-sky-900 ${text.waiter}`}>
          {missing}
        </p>
      )}
      <div className="flex-1">
        <LineList lines={order.lines} size={textSize} />
      </div>
      {order.notes && (
        <p className={`break-words rounded-lg bg-amber-100 px-3 py-2 font-medium text-amber-900 ${text.note}`}>
          Nota del pedido: {order.notes}
        </p>
      )}
      <button
        type="button"
        aria-label={actionLabel}
        disabled={pending}
        onClick={onAction}
        className={`flex min-h-16 items-center justify-center rounded-xl font-bold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${actionClassName}`}
      >
        {actionContent}
      </button>
    </li>
  )
}
