import { useId, useRef, useState } from 'react'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { formatMoney, parseMoneyInput } from '../../../shared/money'
import { calculateChangeCents } from '../domain/change'

interface CheckoutFormProps {
  totalCents: number
  isEmpty: boolean
  isSubmitting: boolean
  onConfirm: (receivedCents: number) => Promise<void>
}

export function CheckoutForm({ totalCents, isEmpty, isSubmitting, onConfirm }: CheckoutFormProps) {
  const inputId = useId()
  const pending = useRef(false)
  const [receivedInput, setReceivedInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const receivedCents = parseMoneyInput(receivedInput)
  const valid = receivedCents !== null && Number.isSafeInteger(receivedCents)
  const change = valid && receivedCents >= totalCents ? calculateChangeCents(totalCents, receivedCents) : null
  const canConfirm = !isEmpty && change !== null && !isSubmitting
  const feedback = receivedInput.trim() === '' ? 'Ingresa el monto recibido.'
    : !valid ? 'Ingresa un monto válido, sin valores negativos.'
    : change === null ? `El monto recibido es insuficiente. Faltan ${formatMoney(totalCents - receivedCents)}.`
    : `Cambio: ${formatMoney(change)}`

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current || !canConfirm || receivedCents === null) return
    pending.current = true
    setError(null)
    try {
      await onConfirm(receivedCents)
      setReceivedInput('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo registrar la venta.')
    } finally {
      pending.current = false
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" aria-label="Pago en efectivo" aria-busy={isSubmitting}>
      {error && <ErrorBanner message={error} />}
      <Input
        id={inputId}
        label="Monto recibido"
        inputMode="decimal"
        placeholder="0.00"
        value={receivedInput}
        disabled={isSubmitting}
        aria-describedby={`${inputId}-feedback`}
        aria-invalid={receivedInput.trim() !== '' && !valid}
        onChange={(event) => { if (!pending.current) setReceivedInput(event.target.value) }}
      />
      <p id={`${inputId}-feedback`} aria-live="polite" className="rounded-xl bg-slate-100 p-4 font-semibold text-slate-700">
        {feedback}
      </p>
      <button type="submit" disabled={!canConfirm}
        className="w-full rounded-xl bg-emerald-700 px-6 py-4 text-lg font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
        {isSubmitting ? 'Procesando…' : 'Registrar venta'}
      </button>
    </form>
  )
}
