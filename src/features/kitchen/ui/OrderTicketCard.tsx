import type { ReactNode } from 'react'
import { orderLabel, productLineLabel, tokenLabel } from '../../orders/domain/order'
import { pickupGroups, type KitchenLine, type KitchenOrder, type KitchenStation } from '../domain/kitchen'

/** Local time in 12-hour format, e.g. "3:05 pm". */
function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`
}

const PICKUP_STYLES: Record<KitchenStation | 'other', string> = {
  pizza: 'border-red-600 bg-red-50 text-red-900',
  grill: 'border-blue-600 bg-blue-50 text-blue-900',
  other: 'border-slate-400 bg-slate-50 text-slate-800',
}

function LineList({ lines }: { lines: KitchenLine[] }) {
  return (
    <ul className="space-y-2 text-lg text-slate-800">
      {lines.map((line) => (
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
  )
}

interface OrderTicketCardProps {
  order: KitchenOrder
  /** Position in the station queue (1 = cook first); omitted on boards without a queue. */
  turn?: number
  /** Groups the lines by pickup place (delivery); otherwise one plain list (kitchen). */
  groupByPickup?: boolean
  actionLabel: string
  actionContent: ReactNode
  actionClassName: string
  pending: boolean
  onAction: () => void
}

/** Order ticket shared by the kitchen and delivery boards, with one big action button. */
export function OrderTicketCard({
  order,
  turn,
  groupByPickup = false,
  actionLabel,
  actionContent,
  actionClassName,
  pending,
  onAction,
}: OrderTicketCardProps) {
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          {turn !== undefined && (
            <span
              aria-label={`Turno ${turn}`}
              className="shrink-0 rounded-lg bg-slate-900 px-3 py-1 text-3xl font-black text-white"
            >
              #{turn}
            </span>
          )}
          <h3 className="min-w-0 break-words text-2xl font-bold text-slate-900">{orderLabel(order)}</h3>
        </div>
        <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-700">
          {formatTime(order.createdAt)}
        </span>
      </div>
      <p className="self-start rounded-lg border-2 border-amber-500 bg-amber-50 px-3 py-1 text-xl font-bold text-amber-900">
        {tokenLabel(order.token)}
      </p>
      {order.waiterName && <p className="text-sm text-slate-500">Atendió: {order.waiterName}</p>}
      {groupByPickup ? (
        <div className="flex flex-1 flex-col gap-3">
          {pickupGroups(order.lines).map((group) => (
            <div
              key={group.station ?? 'other'}
              role="group"
              aria-label={group.label}
              className={`rounded-lg border-l-8 px-3 py-2 ${PICKUP_STYLES[group.station ?? 'other']}`}
            >
              <p className="mb-1 text-base font-bold">{group.label}</p>
              <LineList lines={group.lines} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1">
          <LineList lines={order.lines} />
        </div>
      )}
      {order.notes && (
        <p className="break-words rounded-lg bg-amber-100 px-3 py-2 text-base font-medium text-amber-900">
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
