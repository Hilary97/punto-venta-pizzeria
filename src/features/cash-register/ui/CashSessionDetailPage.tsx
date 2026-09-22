import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { MoneyText } from '../../../shared/ui/MoneyText'
import { Spinner } from '../../../shared/ui/Spinner'
import { toUserMessage } from '../../../shared/errors'
import type { ReturnRecord } from '../../returns/domain/returnRecord'
import { listSessionSalesWithItems, listSessionReturns } from '../../returns/infrastructure/returnsRepository'
import type { SaleWithItems } from '../../sales/domain/sale'
import type { CashSession } from '../domain/cashSession'
import { attachProductNamesToReturnItems, summarizeProductsSold } from '../domain/sessionDetailView'
import { getCashSummary, getClosedSessionById, type CashSummaryReport } from '../infrastructure/cashRegisterRepository'
import { CashCutSummary } from './CashCutSummary'

export function CashSessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>()

  const [session, setSession] = useState<CashSession | null>(null)
  const [summary, setSummary] = useState<CashSummaryReport | null>(null)
  const [sales, setSales] = useState<SaleWithItems[]>([])
  const [returns, setReturns] = useState<ReturnRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return
    const currentSessionId = sessionId

    async function load() {
      setIsLoading(true)
      setErrorMessage(null)
      try {
        const [sessionResult, summaryResult, salesResult, returnsResult] = await Promise.all([
          getClosedSessionById(currentSessionId),
          getCashSummary(currentSessionId),
          listSessionSalesWithItems(currentSessionId),
          listSessionReturns(currentSessionId),
        ])
        setSession(sessionResult)
        setSummary(summaryResult)
        setSales(salesResult)
        setReturns(returnsResult)
      } catch (error) {
        setErrorMessage(toUserMessage(error))
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [sessionId])

  if (isLoading) {
    return <Spinner label="Cargando detalle del corte…" />
  }

  if (errorMessage || !session || !summary) {
    return (
      <div className="p-4">
        <ErrorBanner message={errorMessage ?? 'No se pudo cargar el detalle del corte.'} />
      </div>
    )
  }

  const productsSold = summarizeProductsSold(sales)
  const returnViews = attachProductNamesToReturnItems(returns, sales)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Detalle del corte</h1>
        <Link to="/admin/historial" className="font-semibold text-red-700 underline">
          Volver
        </Link>
      </div>

      <CashCutSummary
        openingCents={summary.openingCents}
        salesTotalCents={summary.salesTotalCents}
        returnsTotalCents={summary.returnsTotalCents}
        expectedCents={summary.expectedCents}
        salesCount={summary.salesCount}
        returnsCount={summary.returnsCount}
        openedAt={session.openedAt}
        closedAt={session.closedAt}
        countedCents={session.countedCents}
        differenceCents={session.differenceCents}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-slate-900">Ventas</h2>
        {sales.length === 0 ? (
          <p className="text-slate-500">No hubo ventas en este corte.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Fecha</th>
                  <th className="px-4 py-3 font-semibold">Total</th>
                  <th className="px-4 py-3 font-semibold">Recibido</th>
                  <th className="px-4 py-3 font-semibold">Cambio</th>
                  <th className="px-4 py-3 font-semibold">Artículos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td className="px-4 py-3">{new Date(sale.createdAt).toLocaleString('es-MX')}</td>
                    <td className="px-4 py-3">
                      <MoneyText cents={sale.totalCents} />
                    </td>
                    <td className="px-4 py-3">
                      <MoneyText cents={sale.receivedCents} />
                    </td>
                    <td className="px-4 py-3">
                      <MoneyText cents={sale.changeCents} />
                    </td>
                    <td className="px-4 py-3">{sale.items.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-slate-900">Productos vendidos</h2>
        {productsSold.length === 0 ? (
          <p className="text-slate-500">No hubo productos vendidos en este corte.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Producto</th>
                  <th className="px-4 py-3 font-semibold">Vendidos</th>
                  <th className="px-4 py-3 font-semibold">Devueltos</th>
                  <th className="px-4 py-3 font-semibold">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {productsSold.map((product) => (
                  <tr key={product.productId ?? `name:${product.productName}`}>
                    <td className="px-4 py-3">{product.productName}</td>
                    <td className="px-4 py-3">{product.quantitySold}</td>
                    <td className="px-4 py-3">{product.quantityReturned}</td>
                    <td className="px-4 py-3">
                      <MoneyText cents={product.subtotalCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-slate-900">Devoluciones</h2>
        {returnViews.length === 0 ? (
          <p className="text-slate-500">No hubo devoluciones en este corte.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Fecha</th>
                  <th className="px-4 py-3 font-semibold">Motivo</th>
                  <th className="px-4 py-3 font-semibold">Productos</th>
                  <th className="px-4 py-3 font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {returnViews.map((returnView) => (
                  <tr key={returnView.returnId}>
                    <td className="px-4 py-3">{new Date(returnView.createdAt).toLocaleString('es-MX')}</td>
                    <td className="px-4 py-3">{returnView.reason ?? '—'}</td>
                    <td className="px-4 py-3">
                      {returnView.items.map((item) => `${item.productName} (${item.quantity})`).join(', ')}
                    </td>
                    <td className="px-4 py-3">
                      <MoneyText cents={returnView.totalCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
