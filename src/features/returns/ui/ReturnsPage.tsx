import { useEffect, useState } from 'react'
import { useCashSession } from '../../cash-register/ui/CashSessionContext'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import { toUserMessage } from '../../../shared/errors'
import type { SaleWithItems } from '../../sales/domain/sale'
import { listSessionSalesWithItems } from '../infrastructure/returnsRepository'
import { SaleSearch } from './SaleSearch'

export function ReturnsPage() {
  const { state } = useCashSession()
  const [sales, setSales] = useState<SaleWithItems[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

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

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-slate-900">Historial de Ventas</h1>
      <SaleSearch sales={sales} />
    </div>
  )
}
