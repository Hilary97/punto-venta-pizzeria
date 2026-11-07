import { useId, useRef, useState } from 'react'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { formatMoney, parseMoneyInput } from '../../../shared/money'
import { calculateChangeCents } from '../domain/change'
import { splitCents } from '../domain/split'

const MAX_PEOPLE = 50

interface CheckoutFormProps {
  totalCents: number
  isEmpty: boolean
  isSubmitting: boolean
  onConfirm: (receivedCents: number) => Promise<void>
}

interface PaymentState {
  receivedCents: number | null
  valid: boolean
  change: number | null
}

function readPayment(input: string, dueCents: number): PaymentState {
  const receivedCents = parseMoneyInput(input)
  const valid = receivedCents !== null && Number.isSafeInteger(receivedCents)
  const change = valid && receivedCents >= dueCents ? calculateChangeCents(dueCents, receivedCents) : null
  return { receivedCents, valid, change }
}

export function CheckoutForm({ totalCents, isEmpty, isSubmitting, onConfirm }: CheckoutFormProps) {
  const inputId = useId()
  const pending = useRef(false)
  const [receivedInput, setReceivedInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [splitEnabled, setSplitEnabled] = useState(false)
  const [peopleInput, setPeopleInput] = useState('2')
  const [personInputs, setPersonInputs] = useState<string[]>([])
  const [charged, setCharged] = useState<boolean[]>([])

  const peopleCount = Number(peopleInput)
  const shares = peopleCount <= MAX_PEOPLE ? splitCents(totalCents, peopleCount) : []
  const personPayments = shares.map((shareCents, index) => ({ shareCents, ...readPayment(personInputs[index] ?? '', shareCents) }))
  const chargedCount = shares.filter((_, index) => charged[index]).length
  const splitSettled = shares.length > 0 && chargedCount === shares.length
  const splitReceivedCents = personPayments.reduce((sum, payment) => sum + (payment.receivedCents ?? 0), 0)

  const { receivedCents, valid, change } = readPayment(receivedInput, totalCents)
  const confirmedReceivedCents = splitEnabled ? (splitSettled ? splitReceivedCents : null) : (change !== null ? receivedCents : null)
  const canConfirm = !isEmpty && confirmedReceivedCents !== null && !isSubmitting
  const feedback = receivedInput.trim() === '' ? 'Ingresa el monto recibido.'
    : !valid ? 'Ingresa un monto válido, sin valores negativos.'
    : change === null ? `El monto recibido es insuficiente. Faltan ${formatMoney(totalCents - (receivedCents ?? 0))}.`
    : `Cambio: ${formatMoney(change)}`

  function resetSplit() {
    setPersonInputs([])
    setCharged([])
  }

  function updateAt<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, index: number, value: T) {
    setter((previous) => {
      const next = [...previous]
      next[index] = value
      return next
    })
  }

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current || !canConfirm || confirmedReceivedCents === null) return
    pending.current = true
    setError(null)
    try {
      await onConfirm(confirmedReceivedCents)
      setReceivedInput('')
      setSplitEnabled(false)
      setPeopleInput('2')
      resetSplit()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo registrar la venta.')
    } finally {
      pending.current = false
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" aria-label="Pago en efectivo" aria-busy={isSubmitting}>
      {error && <ErrorBanner message={error} />}
      <label className="flex items-center gap-2 font-medium text-slate-700">
        <input type="checkbox" className="h-5 w-5" checked={splitEnabled} disabled={isSubmitting}
          onChange={(event) => { setSplitEnabled(event.target.checked); resetSplit() }} />
        Dividir cuenta
      </label>
      {!splitEnabled && (
        <>
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
        </>
      )}
      {splitEnabled && (
        <div className="flex flex-col gap-3">
          <Input
            id={`${inputId}-people`}
            label="Número de personas"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_PEOPLE}
            step={1}
            value={peopleInput}
            disabled={isSubmitting}
            error={shares.length === 0 ? `Ingresa un número entero entre 1 y ${MAX_PEOPLE}.` : undefined}
            onChange={(event) => { setPeopleInput(event.target.value); resetSplit() }}
          />
          {shares.length > 0 && (
            <>
              <p aria-live="polite" className="rounded-xl bg-slate-100 p-3 font-semibold text-slate-700">
                Cobradas {chargedCount} de {shares.length}
              </p>
              <ul className="flex flex-col gap-2">
                {personPayments.map(({ shareCents, ...payment }, index) => (
                  <li key={index}>
                    <PersonPaymentRow
                      person={index + 1}
                      shareCents={shareCents}
                      input={personInputs[index] ?? ''}
                      payment={payment}
                      charged={Boolean(charged[index])}
                      disabled={isSubmitting}
                      onInputChange={(value) => updateAt(setPersonInputs, index, value)}
                      onChargedChange={(value) => updateAt(setCharged, index, value)}
                    />
                  </li>
                ))}
              </ul>
              {!splitSettled && (
                <p className="text-sm text-slate-600">Cobra a todas las personas para registrar la venta.</p>
              )}
            </>
          )}
        </div>
      )}
      <button type="submit" disabled={!canConfirm}
        className="w-full rounded-xl bg-emerald-700 px-6 py-4 text-lg font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
        {isSubmitting ? 'Procesando…' : 'Registrar venta'}
      </button>
    </form>
  )
}

interface PersonPaymentRowProps {
  person: number
  shareCents: number
  input: string
  payment: PaymentState
  charged: boolean
  disabled: boolean
  onInputChange: (value: string) => void
  onChargedChange: (charged: boolean) => void
}

function PersonPaymentRow({ person, shareCents, input, payment, charged, disabled, onInputChange, onChargedChange }: PersonPaymentRowProps) {
  const inputId = useId()
  const title = `Persona ${person} · ${formatMoney(shareCents)}`
  const feedback = input.trim() === '' ? 'Ingresa el monto recibido.'
    : !payment.valid ? 'Monto inválido.'
    : payment.change === null ? `Faltan ${formatMoney(shareCents - (payment.receivedCents ?? 0))}.`
    : charged ? `Cobrada · Cambio: ${formatMoney(payment.change)}`
    : `Cambio: ${formatMoney(payment.change)}`

  return (
    <fieldset aria-label={title}
      className={`flex flex-col gap-2 rounded-lg border p-3 ${charged ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`}>
      <div className={`flex items-center justify-between font-semibold ${charged ? 'text-emerald-800' : 'text-slate-700'}`}>
        <span className={charged ? 'line-through' : undefined}>Persona {person}</span>
        <span>{formatMoney(shareCents)}</span>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            id={inputId}
            label={`Recibido de persona ${person}`}
            inputMode="decimal"
            placeholder="0.00"
            value={input}
            disabled={disabled || charged}
            aria-describedby={`${inputId}-feedback`}
            aria-invalid={input.trim() !== '' && !payment.valid}
            onChange={(event) => onInputChange(event.target.value)}
          />
        </div>
        {charged ? (
          <button type="button" disabled={disabled} aria-label={`Deshacer persona ${person}`}
            onClick={() => onChargedChange(false)}
            className="rounded-lg border border-slate-300 px-3 py-2.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            Deshacer
          </button>
        ) : (
          <button type="button" disabled={disabled || payment.change === null} aria-label={`Cobrar persona ${person}`}
            onClick={() => onChargedChange(true)}
            className="rounded-lg bg-emerald-700 px-3 py-2.5 font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
            Cobrar
          </button>
        )}
      </div>
      <p id={`${inputId}-feedback`} aria-live="polite" className={`text-sm font-medium ${charged ? 'text-emerald-800' : 'text-slate-600'}`}>
        {feedback}
      </p>
    </fieldset>
  )
}
