import { MoneyText } from '../../../shared/ui/MoneyText'
import type { OrderQuote } from '../../orders/domain/orderQuote'

interface QuoteLinesPanelProps {
  quote: OrderQuote
  /** Order-level note shown above the lines. */
  orderNotes?: string | null
}

export function QuoteLinesPanel({ quote, orderNotes }: QuoteLinesPanelProps) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h2 className="text-lg font-bold text-slate-900">Pedido</h2>
      {orderNotes && <p className="break-words rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{`Nota del pedido: ${orderNotes}`}</p>}
      <ul className="divide-y divide-slate-200">
        {quote.lines.map((line) => (
          <li key={line.orderItemId} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0 basis-full">
              <p className="break-words font-medium text-slate-900">{line.name}</p>
              {line.unitPriceCents !== null && <MoneyText cents={line.unitPriceCents} className="text-sm text-slate-500" />}
              {line.notes && <p className="break-words text-sm text-slate-600">{`Nota: ${line.notes}`}</p>}
            </div>
            <span className="font-semibold">× {line.quantity}</span>
            {line.lineTotalCents !== null && <MoneyText cents={line.lineTotalCents} className="w-20 text-right font-semibold" />}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-xl font-bold text-slate-900">
        <span>Total</span>
        <MoneyText cents={quote.totalCents} />
      </div>
    </div>
  )
}
