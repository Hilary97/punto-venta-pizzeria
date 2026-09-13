import { useState } from 'react'
import { MoneyText } from '../../../shared/ui/MoneyText'
import type { SaleWithItems } from '../../sales/domain/sale'

interface SaleSearchProps {
  sales: SaleWithItems[]
  onSelectSale: (sale: SaleWithItems) => void
}

function matchesQuery(sale: SaleWithItems, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') return true

  const shortId = sale.id.slice(0, 8).toLowerCase()
  const time = new Date(sale.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

  return shortId.includes(normalizedQuery) || time.includes(normalizedQuery)
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
        placeholder="Buscar por folio o hora (ej. 09:15)"
        aria-label="Buscar venta"
        className="rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-200"
      />

      {filteredSales.length === 0 ? (
        <p className="p-4 text-center text-slate-500">No se encontraron ventas de hoy con ese criterio.</p>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200 bg-white">
          {filteredSales.map((sale) => (
            <li key={sale.id}>
              <button
                type="button"
                onClick={() => onSelectSale(sale)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
              >
                <div>
                  <p className="font-semibold text-slate-900">Folio {sale.id.slice(0, 8)}</p>
                  <p className="text-sm text-slate-500">
                    {new Date(sale.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                    {sale.items.length} producto(s)
                  </p>
                </div>
                <MoneyText cents={sale.totalCents} className="font-semibold" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
