import { useEffect, useState } from 'react'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { MoneyText } from '../../../shared/ui/MoneyText'
import { Spinner } from '../../../shared/ui/Spinner'
import { toUserMessage } from '../../../shared/errors'
import { currentMonthRange, purchaseRange, type SupplyPurchase } from '../domain/supply'
import { listPurchases } from '../infrastructure/suppliesRepository'
import { formatQuantityWithUnit } from './formatQuantity'

interface PurchasesHistoryProps {
  /** Changing this value reloads the list (e.g. after a new purchase). */
  reloadKey: number
}

export function PurchasesHistory({ reloadKey }: PurchasesHistoryProps) {
  const [initialRange] = useState(() => currentMonthRange(new Date()))
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)
  // The result remembers which request it answers, so "loading" is derived instead of set in the effect.
  const [result, setResult] = useState<{
    requestKey: string
    purchases: SupplyPurchase[]
    errorMessage: string | null
  } | null>(null)

  const isRangeValid = from !== '' && to !== '' && from <= to
  const requestKey = `${from}|${to}|${reloadKey}`
  const isLoading = result?.requestKey !== requestKey
  const purchases = result?.purchases ?? []
  const errorMessage = result?.errorMessage ?? null

  useEffect(() => {
    if (!isRangeValid) return
    let cancelled = false
    const range = purchaseRange(from, to)
    listPurchases(range.from, range.to)
      .then((loaded) => ({ requestKey, purchases: loaded, errorMessage: null }))
      .catch((error: unknown) => ({ requestKey, purchases: [], errorMessage: toUserMessage(error) }))
      .then((next) => {
        if (!cancelled) setResult(next)
      })
    return () => {
      cancelled = true
    }
  }, [from, to, isRangeValid, requestKey])

  const total = purchases.reduce((sum, purchase) => sum + purchase.costCents, 0)

  return (
    <section aria-labelledby="purchases-history-title" className="flex flex-col gap-4">
      <h2 id="purchases-history-title" className="text-xl font-bold text-slate-900">
        Historial de compras
      </h2>

      <div className="flex flex-wrap items-start gap-4">
        <Input id="purchases-from" type="date" label="Desde" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input id="purchases-to" type="date" label="Hasta" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {!isRangeValid ? (
        <p className="text-sm text-red-600">El rango de fechas no es válido.</p>
      ) : isLoading ? (
        <Spinner label="Cargando compras…" />
      ) : (
        <>
          {errorMessage && <ErrorBanner message={errorMessage} />}
          {purchases.length === 0 && !errorMessage ? (
            <p className="p-4 text-center text-slate-500">No hay compras en este rango.</p>
          ) : (
            purchases.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table aria-label="Compras" className="w-full text-left text-sm">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Fecha</th>
                      <th className="px-4 py-3 font-semibold">Insumo</th>
                      <th className="px-4 py-3 font-semibold">Cantidad</th>
                      <th className="px-4 py-3 font-semibold">Pagado</th>
                      <th className="px-4 py-3 font-semibold">Registró</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {purchases.map((purchase) => (
                      <tr key={purchase.id}>
                        <td className="px-4 py-3">{new Date(purchase.createdAt).toLocaleString('es-MX')}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{purchase.supplyName}</td>
                        <td className="px-4 py-3">{formatQuantityWithUnit(purchase.quantity, purchase.unit)}</td>
                        <td className="px-4 py-3">
                          <MoneyText cents={purchase.costCents} />
                        </td>
                        <td className="px-4 py-3">{purchase.createdByName ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
          <p className="text-right text-lg font-bold text-slate-900">
            Total gastado: <MoneyText cents={total} />
          </p>
        </>
      )}
    </section>
  )
}
