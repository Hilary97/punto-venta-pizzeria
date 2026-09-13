import { useEffect, useState } from 'react'
import { useCashSession } from '../../cash-register/ui/CashSessionContext'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import { formatMoney } from '../../../shared/money'
import { toUserMessage } from '../../../shared/errors'
import type { SaleWithItems } from '../../sales/domain/sale'
import { createReturn, listSessionSalesWithItems } from '../infrastructure/returnsRepository'
import { ReturnItemsForm } from './ReturnItemsForm'
import { SaleSearch } from './SaleSearch'

export function ReturnsPage() {
  const { state } = useCashSession()
  const [sales, setSales] = useState<SaleWithItems[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedSale, setSelectedSale] = useState<SaleWithItems | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const sessionId = state.session?.id

  useEffect(() => {
    if (!sessionId) return
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        setSales(await listSessionSalesWithItems(sessionId as string))
      } catch (error) {
        setLoadError(toUserMessage(error))
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [sessionId])

  if (isLoading) {
    return <Spinner label="Cargando ventas del día…" />
  }

  if (loadError) {
    return (
      <div className="p-4">
        <ErrorBanner message={loadError} />
      </div>
    )
  }

  async function handleConfirmReturn(selection: { saleItemId: string; quantity: number }[], reason: string) {
    if (!selectedSale) return
    const result = await createReturn(selectedSale.id, selection, reason)
    setSuccessMessage(`Devolución registrada. Efectivo a entregar: ${formatMoney(result.totalCents)}.`)
    setSelectedSale(null)
    if (sessionId) {
      setSales(await listSessionSalesWithItems(sessionId))
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-slate-900">Devoluciones</h1>

      {successMessage && (
        <div
          role="status"
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
        >
          {successMessage}
        </div>
      )}

      {selectedSale ? (
        <ReturnItemsForm sale={selectedSale} onConfirm={handleConfirmReturn} onCancel={() => setSelectedSale(null)} />
      ) : (
        <SaleSearch
          sales={sales}
          onSelectSale={(sale) => {
            setSuccessMessage(null)
            setSelectedSale(sale)
          }}
        />
      )}
    </div>
  )
}
