import type { ReactNode } from 'react'
import { orderLabel, productLineLabel } from '../../orders/domain/order'
import type { KitchenOrder } from '../domain/kitchen'

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
}

interface OrderTicketCardProps {
  order: KitchenOrder
  actionLabel: string
  actionContent: ReactNode
  actionClassName: string
  pending: boolean
  onAction: () => void
}

/** Order ticket shared by the kitchen and delivery boards, with one big action button. */
export function OrderTicketCard({
  order,
  actionLabel,
  actionContent,
  actionClassName,
  pending,
  onAction,
}: OrderTicketCardProps) {
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
