import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Spinner } from '../../../shared/ui/Spinner'
import { toUserMessage } from '../../../shared/errors'
import { parseMoneyInput } from '../../../shared/money'
import type { CashSession } from '../domain/cashSession'
import { computeCashSummary } from '../domain/cashSummary'
import { closeCashSession, getCashSummary, type CashSummaryReport } from '../infrastructure/cashRegisterRepository'
import { CashCutSummary } from './CashCutSummary'
import { useCashSession } from './CashSessionContext'

export function CashCutPage() {
  const { state, refresh } = useCashSession()
  // Snapshot the session as soon as it loads so the summary stays visible
  // after `closeCashSession` makes the register report "no open session".
  const [session, setSession] = useState<CashSession | null>(null)
  const [summary, setSummary] = useState<CashSummaryReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [countedInput, setCountedInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [closedResult, setClosedResult] = useState<{ countedCents: number; differenceCents: number } | null>(null)

  useEffect(() => {
    if (state.session && !session) {
      setSession(state.session)
    }
  }, [state.session, session])

  useEffect(() => {
    if (!session) return
    const sessionId = session.id

    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const report = await getCashSummary(sessionId)
        setSummary(report)
      } catch (error) {
        setLoadError(toUserMessage(error))
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [session])

  if (state.status === 'loading' && !session) {
    return <Spinner label="Cargando sesión de caja…" />
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-lg font-medium text-slate-700">No hay una caja abierta para hacer el corte.</p>
        <Link to="/abrir-caja" className="font-semibold text-red-700 underline">
          Abrir caja
        </Link>
      </div>
    )
  }

  if (isLoading) {
    return <Spinner label="Calculando resumen de caja…" />
  }

  if (loadError || !summary) {
    return (
      <div className="p-4">
        <ErrorBanner message={loadError ?? 'No se pudo cargar el resumen de caja.'} />
      </div>
    )
  }

  const countedCents = parseMoneyInput(countedInput)
  const preview =
    countedCents !== null
      ? computeCashSummary({
          openingCents: summary.openingCents,
          salesTotalCents: summary.salesTotalCents,
          returnsTotalCents: summary.returnsTotalCents,
          countedCents,
        })
      : null

  async function handleClose() {
    if (countedCents === null) {
      setSubmitError('Ingresa el efectivo contado antes de cerrar la caja.')
      return
    }
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      const result = await closeCashSession(countedCents)
      setClosedResult(result)
      await refresh()
    } catch (error) {
      setSubmitError(toUserMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 p-4 sm:p-6 print:max-w-none">
      <h1 className="text-2xl font-bold text-slate-900 print:hidden">Corte de caja</h1>

      <CashCutSummary
        openingCents={summary.openingCents}
        salesTotalCents={summary.salesTotalCents}
        returnsTotalCents={summary.returnsTotalCents}
        expectedCents={summary.expectedCents}
        salesCount={summary.salesCount}
        returnsCount={summary.returnsCount}
        openedAt={session.openedAt}
        closedAt={closedResult ? new Date().toISOString() : null}
        countedCents={closedResult ? closedResult.countedCents : (preview?.countedCents ?? null)}
        differenceCents={closedResult ? closedResult.differenceCents : (preview?.differenceCents ?? null)}
      />

      {!closedResult && (
        <div className="flex flex-col gap-4 print:hidden">
          {submitError && <ErrorBanner message={submitError} />}
          <Input
            id="counted-amount"
            label="Efectivo contado (MXN)"
            inputMode="decimal"
            placeholder="0.00"
            value={countedInput}
            onChange={(e) => setCountedInput(e.target.value)}
          />
          <Button size="lg" disabled={isSubmitting} onClick={handleClose}>
            {isSubmitting ? 'Cerrando caja…' : 'Cerrar caja'}
          </Button>
        </div>
      )}

      {closedResult && (
        <div className="flex flex-col gap-3 print:hidden">
          <p className="text-center font-medium text-emerald-700">Caja cerrada correctamente.</p>
          <Button variant="secondary" onClick={() => window.print()}>
            Imprimir corte
          </Button>
        </div>
      )}
    </div>
  )
}
