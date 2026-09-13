import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { parseMoneyInput } from '../../../shared/money'
import { openCashSession } from '../infrastructure/cashRegisterRepository'
import { useCashSession } from './CashSessionContext'

export function OpenRegisterPage() {
  const { state, refresh } = useCashSession()
  const [openingInput, setOpeningInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (state.status === 'open') {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const openingCents = parseMoneyInput(openingInput)
    if (openingCents === null) {
      setError('Ingresa un fondo inicial válido, por ejemplo 500.00.')
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      await openCashSession(openingCents)
      await refresh()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo abrir la caja.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="mb-1 text-center text-2xl font-bold text-slate-900">Abrir caja</h1>
        <p className="mb-6 text-center text-sm text-slate-500">
          Ingresa el fondo inicial en efectivo para comenzar a vender.
        </p>

        {error && (
          <div className="mb-4">
            <ErrorBanner message={error} />
          </div>
        )}

        <div className="flex flex-col gap-4">
          <Input
            id="opening-amount"
            label="Fondo inicial (MXN)"
            inputMode="decimal"
            placeholder="500.00"
            required
            value={openingInput}
            onChange={(e) => setOpeningInput(e.target.value)}
          />
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? 'Abriendo…' : 'Abrir caja'}
          </Button>
        </div>
      </form>
    </div>
  )
}
