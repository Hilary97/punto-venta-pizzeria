import { cn } from '../../../shared/ui/cn'

interface ToggleChipProps {
  label: string
  pressed: boolean
  onToggle: () => void
  disabled?: boolean
}

/** Touch-sized toggle button used for sizes, divisions, ingredients and extras. */
export function ToggleChip({ label, pressed, onToggle, disabled = false }: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'min-h-11 rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40',
        pressed ? 'bg-red-700 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300',
      )}
    >
      {label}
    </button>
  )
}
