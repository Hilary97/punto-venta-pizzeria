import { useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { MoneyText } from '../../../shared/ui/MoneyText'
import type { SaleWithItems } from '../../sales/domain/sale'
import { calculateReturnableQuantity } from '../domain/returnable'

interface SaleSearchProps {
  sales: SaleWithItems[]
  onSelectSale: (sale: SaleWithItems) => void
}

function formatTime(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

function formatTable(tableNumber: number): string {
  return `Mesa ${tableNumber}`
}

function matchesQuery(sale: SaleWithItems, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') return true

  const shortId = sale.id.slice(0, 8).toLowerCase()
  const customer = sale.customerName?.toLowerCase() ?? ''
  const table = sale.tableNumber == null ? '' : formatTable(sale.tableNumber).toLowerCase()

  return (
    shortId.includes(normalizedQuery) ||
    formatTime(sale.createdAt).includes(normalizedQuery) ||
    customer.includes(normalizedQuery) ||
    table.includes(normalizedQuery)
  )
}

function hasReturnableItems(sale: SaleWithItems): boolean {
  return sale.items.some((item) => calculateReturnableQuantity(item.quantity, item.returnedQuantity) > 0)
}

export function SaleSearch({ sales, onSelectSale }: SaleSearchProps) {
  const [query, setQuery] = useState('')
  const filteredSales = sales.filter((sale) => matchesQuery(sale, query))

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar por cliente, mesa, folio o hora (ej. 09:15)"
        aria-label="Buscar venta"
        className="rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-200"
      />

      {filteredSales.length === 0 ? (
        <p className="p-4 text-center text-slate-500">No se encontraron ventas de hoy con ese criterio.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredSales.map((sale) => (
            <article key={sale.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <header className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{sale.customerName || (sale.tableNumber != null ? 'Sin nombre' : 'Venta en mostrador')}</p>
                  {sale.tableNumber != null && (
                    <p className="text-sm text-slate-600">{formatTable(sale.tableNumber)}</p>
                  )}
                  {sale.waiterName && <p className="text-sm text-slate-500">Atendió: {sale.waiterName}</p>}
                </div>
                <div className="shrink-0 text-right text-sm text-slate-500">
                  <p>Folio {sale.id.slice(0, 8)}</p>
                  <p>{formatTime(sale.createdAt)}</p>
                </div>
              </header>

              <ul className="divide-y divide-slate-100 text-sm">
                {sale.items.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-2 py-1.5">
                    <div className="min-w-0">
                      <p className="text-slate-800">
                        {item.quantity} × {item.productName}
                      </p>
                      {item.returnedQuantity > 0 && (
                        <p className="text-xs text-red-700">{item.returnedQuantity} devuelto(s)</p>
                      )}
                    </div>
                    <MoneyText cents={item.unitPriceCents * item.quantity} className="shrink-0 text-slate-700" />
                  </li>
                ))}
              </ul>

              <dl className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-600">Total</dt>
                  <dd>
                    <MoneyText cents={sale.totalCents} className="font-bold text-slate-900" />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-600">Recibido</dt>
                  <dd>
                    <MoneyText cents={sale.receivedCents} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-600">Cambio</dt>
                  <dd>
                    <MoneyText cents={sale.changeCents} />
                  </dd>
                </div>
              </dl>

              <Button
                type="button"
                variant="secondary"
                disabled={!hasReturnableItems(sale)}
                onClick={() => onSelectSale(sale)}
              >
                {hasReturnableItems(sale) ? 'Devolver' : 'Devolver (todo devuelto)'}
              </Button>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
