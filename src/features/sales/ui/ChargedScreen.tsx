import { useEffect, useId, useRef } from 'react'
import { formatMoney } from '../../../shared/money'

export interface ChargedSale {
  label: string
  totalCents: number
  changeCents: number
}

interface ChargedScreenProps {
  sale: ChargedSale
  onDone: () => void
}

/** Full-screen confirmation after charging, so the cashier reads the change to hand over at a glance. */
export function ChargedScreen({ sale, onDone }: ChargedScreenProps) {
  const titleId = useId()
  const doneRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    doneRef.current?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDone()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onDone])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-emerald-700 p-6 text-center text-white"
    >
      <p id={titleId} className="text-xl font-semibold">{`${sale.label} cobrado · Total ${formatMoney(sale.totalCents)}`}</p>
      <p className="text-xl font-semibold">Entrega de cambio</p>
      <p className="text-7xl leading-none font-extrabold tabular-nums sm:text-8xl">{formatMoney(sale.changeCents)}</p>
      <button
        ref={doneRef}
        type="button"
        onClick={onDone}
        className="mt-5 min-h-15 rounded-2xl bg-white px-8 text-lg font-extrabold text-emerald-800 hover:bg-emerald-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Listo, siguiente cobro
      </button>
    </div>
  )
}
