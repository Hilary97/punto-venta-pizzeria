import { useId, useRef, useState } from 'react'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { cn } from '../../../shared/ui/cn'
import { formatMoney, parseMoneyInput } from '../../../shared/money'
import { calculateChangeCents } from '../domain/change'
import { splitCents } from '../domain/split'

const MAX_PEOPLE = 50
/** Keypad entry stops growing past this many whole-peso digits. */
const MAX_KEYPAD_DIGITS = 7
const QUICK_BILLS_PESOS = [50, 100, 200, 500] as const
const KEYPAD_DIGITS = ['7', '8', '9', '4', '5', '6', '1', '2', '3'] as const

/** Writes cents back as the plain string the cashier would type, e.g. `650` or `650.50`. */
function centsToInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)
}

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
  const isBlank = receivedInput.trim() === ''
  const changeTone = isBlank ? 'idle' : !valid || change === null ? 'short' : 'ok'
  const changeLabel = isBlank || change !== null ? 'Cambio' : !valid ? 'Monto no válido' : 'Faltan'
  const changeValue = change !== null ? formatMoney(change)
    : valid && !isBlank ? formatMoney(totalCents - (receivedCents ?? 0))
    : '—'

  function setReceived(next: string) {
    if (!pending.current) setReceivedInput(next)
  }

  function pressDigit(digit: string) {
    const plain = receivedInput.replace(/,/g, '')
    if (!plain.includes('.') && plain.length >= MAX_KEYPAD_DIGITS) return
    setReceived(plain === '0' ? digit : plain + digit)
  }

  function addBill(pesos: number) {
    const current = valid && receivedCents !== null ? receivedCents : 0
    setReceived(centsToInput(current + pesos * 100))
  }

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
          {/* Narrow screens: one row per readout (label left, amount right) so long amounts never clip. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
            <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2 focus-within:border-sky-700 focus-within:ring-2 focus-within:ring-sky-200 sm:flex-col sm:items-stretch sm:py-3">
              <label htmlFor={inputId} className="shrink-0 text-xs font-bold tracking-wide text-slate-600 uppercase">Monto recibido</label>
              <div className="flex min-w-0 items-baseline justify-end gap-1 sm:justify-start">
                <span aria-hidden="true" className="text-2xl font-bold text-slate-500">$</span>
                <input
                  id={inputId}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={receivedInput}
                  disabled={isSubmitting}
                  aria-describedby={`${inputId}-feedback`}
                  aria-invalid={!isBlank && !valid}
                  onChange={(event) => setReceived(event.target.value)}
                  className="w-full min-w-0 bg-transparent text-right text-2xl font-extrabold text-slate-900 tabular-nums outline-none placeholder:text-slate-400 sm:text-left sm:text-3xl lg:text-4xl"
                />
              </div>
            </div>
            <div
              id={`${inputId}-feedback`}
              aria-live="polite"
              className={cn(
                'flex min-w-0 items-center justify-between gap-3 rounded-2xl border px-4 py-2 sm:flex-col sm:items-start sm:justify-start sm:py-3',
                changeTone === 'idle' && 'border-slate-200 bg-white text-slate-600',
                changeTone === 'ok' && 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200',
                changeTone === 'short' && 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200',
              )}
            >
              <span className="shrink-0 text-xs font-bold tracking-wide uppercase">{changeLabel}</span>
              <span className="min-w-0 text-right text-2xl font-extrabold break-all tabular-nums sm:text-left sm:text-3xl lg:text-4xl">{changeValue}</span>
            </div>
          </div>
          <div role="group" aria-label="Billetes rápidos" className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            <button type="button" disabled={isSubmitting} onClick={() => setReceived(centsToInput(totalCents))}
              className="col-span-4 min-h-12 rounded-xl sm:col-span-1 sm:min-h-14 bg-slate-900 font-extrabold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-900 dark:text-slate-50">
              Exacto
            </button>
            {QUICK_BILLS_PESOS.map((pesos) => (
              <button key={pesos} type="button" disabled={isSubmitting} onClick={() => addBill(pesos)}
                className="min-h-12 rounded-xl border border-slate-300 bg-white px-1 font-extrabold sm:min-h-14 text-slate-900 tabular-nums hover:bg-slate-100 disabled:opacity-50">
                {`+$${pesos}`}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Teclado numérico" className="grid grid-cols-3 gap-2">
            {KEYPAD_DIGITS.map((digit) => (
              <KeypadButton key={digit} disabled={isSubmitting} onClick={() => pressDigit(digit)}>{digit}</KeypadButton>
            ))}
            <KeypadButton variant="fn" disabled={isSubmitting} onClick={() => setReceived('')}>Borrar todo</KeypadButton>
            <KeypadButton disabled={isSubmitting} onClick={() => pressDigit('0')}>0</KeypadButton>
            <KeypadButton variant="fn" disabled={isSubmitting} aria-label="Borrar último dígito"
              onClick={() => setReceived(receivedInput.slice(0, -1))}>
              ⌫
            </KeypadButton>
          </div>
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
        className="min-h-16 w-full rounded-2xl bg-red-700 px-6 text-xl font-extrabold text-white hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600">
        {isSubmitting ? 'Procesando…' : `Cobrar ${formatMoney(totalCents)}`}
      </button>
    </form>
  )
}

interface KeypadButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'digit' | 'fn'
}

function KeypadButton({ variant = 'digit', className, ...props }: KeypadButtonProps) {
  return (
    <button type="button" {...props}
      className={cn(
        'min-h-12 rounded-xl border border-slate-200 font-bold transition-colors disabled:opacity-50 sm:min-h-16',
        variant === 'digit' ? 'bg-white text-2xl text-slate-900 hover:bg-slate-100 active:bg-slate-200' : 'bg-slate-100 text-base text-slate-600 hover:bg-slate-200',
        className,
      )}
    />
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
      className={`flex flex-col gap-2 rounded-lg border p-3 ${charged ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/60' : 'border-slate-200'}`}>
      <div className={`flex items-center justify-between font-semibold ${charged ? 'text-emerald-800 dark:text-emerald-200' : 'text-slate-700'}`}>
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
      <p id={`${inputId}-feedback`} aria-live="polite" className={`text-sm font-medium ${charged ? 'text-emerald-800 dark:text-emerald-200' : 'text-slate-600'}`}>
        {feedback}
      </p>
    </fieldset>
  )
}
