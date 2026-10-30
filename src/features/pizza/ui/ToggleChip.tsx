import { cn } from '../../../shared/ui/cn'

interface ToggleChipProps {
  label: string
  pressed: boolean
  onToggle: () => void
  disabled?: boolean
  /** Small secondary text under the label, e.g. `Agotado`. */
  hint?: string
  /** Second pressed state, e.g. a doubled extra ingredient. */
  emphasized?: boolean
}

/** Touch-sized toggle button used for sizes, divisions, ingredients and extras. */
export function ToggleChip({ label, pressed, onToggle, disabled = false, hint, emphasized = false }: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'min-h-11 rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40',
        pressed && emphasized && 'bg-yellow-400 text-yellow-950 ring-2 ring-yellow-600',
        pressed && !emphasized && 'bg-red-700 text-white',
        !pressed && 'bg-slate-200 text-slate-700 hover:bg-slate-300',
      )}
    >
      {label}
      {hint && <span className="block text-xs font-medium">{hint}</span>}
    </button>
  )
}
