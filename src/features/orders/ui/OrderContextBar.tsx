import { cn } from '../../../shared/ui/cn'

interface OrderContextBarProps {
  /** `M-4 · Aquí · Familia Ortega`. */
  label: string
  onChange: () => void
  /** `bar` is the tinted strip under the step indicator; `summary` is the card at the top of the review. */
  variant?: 'bar' | 'summary'
  disabled?: boolean
}

/** Where the order goes (table, service, customer), always visible after step 1, with a way back to change it. */
export function OrderContextBar({ label, onChange, variant = 'bar', disabled = false }: OrderContextBarProps) {
  return (
    <section
      aria-label="Contexto del pedido"
      className={cn(
        'flex items-center gap-2',
        variant === 'bar'
          ? 'border-b border-red-200 bg-red-50 px-3.5 py-2'
          : 'rounded-xl border border-slate-200 bg-white px-3 py-2',
      )}
    >
      <p className={cn('min-w-0 flex-1 break-words text-sm font-bold', variant === 'bar' ? 'text-red-900' : 'text-slate-900')}>
        {label}
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={onChange}
        className="min-h-11 shrink-0 rounded-lg border-2 border-red-700 bg-white px-3.5 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        Cambiar
      </button>
    </section>
  )
}
