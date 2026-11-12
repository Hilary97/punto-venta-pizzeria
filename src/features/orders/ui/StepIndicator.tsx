import { cn } from '../../../shared/ui/cn'

export type OrderStep = 'mesa' | 'productos' | 'revisar'

const STEPS: { step: OrderStep; label: string }[] = [
  { step: 'mesa', label: 'Mesa' },
  { step: 'productos', label: 'Productos' },
  { step: 'revisar', label: 'Revisar' },
]

interface StepIndicatorProps {
  current: OrderStep
  onGo: (step: OrderStep) => void
  /** The Mesa step cannot be revisited (adding to an open order fixes the table). */
  mesaLocked?: boolean
  disabled?: boolean
}

/** Mesa → Productos → Revisar: the current step is red, finished ones show a check and go back when tapped. */
export function StepIndicator({ current, onGo, mesaLocked = false, disabled = false }: StepIndicatorProps) {
  const currentIndex = STEPS.findIndex((item) => item.step === current)
  return (
    <nav aria-label="Pasos del pedido" className="border-b border-slate-200 bg-white px-2 pb-2.5 pt-2 sm:px-3">
      <ol className="flex gap-1 sm:gap-1.5">
        {STEPS.map(({ step, label }, index) => {
          const isCurrent = step === current
          const isDone = index < currentIndex
          const canGo = isDone && !disabled && !(step === 'mesa' && mesaLocked)
          const badge = (
            <b
              aria-hidden="true"
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded-full text-xs',
                isCurrent ? 'bg-[#fff] text-red-700' : isDone ? 'bg-emerald-700 text-white' : 'bg-slate-300 text-slate-900',
              )}
            >
              {isDone ? '✓' : index + 1}
            </b>
          )
          return (
            <li
              key={step}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex min-h-11 min-w-0 flex-1 items-center rounded-full text-xs font-semibold sm:text-[13px]',
                isCurrent ? 'bg-red-700 text-white' : 'bg-slate-100 text-slate-700',
              )}
            >
              {canGo ? (
                <button
                  type="button"
                  onClick={() => onGo(step)}
                  className="flex min-h-11 w-full min-w-0 items-center gap-1 rounded-full px-1.5 text-left sm:gap-1.5 sm:px-2 font-semibold hover:bg-slate-200"
                >
                  {badge} <span>{label}</span>
                </button>
              ) : (
                <span className="flex min-w-0 items-center gap-1 px-1.5 sm:gap-1.5 sm:px-2">
                  {badge} <span>{label}</span>
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
