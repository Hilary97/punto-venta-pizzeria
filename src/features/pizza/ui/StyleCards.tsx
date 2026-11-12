import { CHILE_VARIANTS } from '../domain/pizza'
import type { PizzaPortion, PizzaStyle } from '../domain/pizza'
import { clearChiles, hasChileVariants, setPortionStyle, toggleChile } from '../domain/pizzaBuilder'
import { cn } from '../../../shared/ui/cn'
import { ToggleChip } from './ToggleChip'

interface StyleCardsProps {
  /** Name of the portion being edited, e.g. `Mitad 1`. */
  title: string
  portion: PizzaPortion
  styles: PizzaStyle[]
  onChange: (portion: PizzaPortion) => void
  /** Once a style is picked only that card shows, with a button to see the list again. */
  collapsed?: boolean
  /** Called when the user picks a card (collapses the list). */
  onPick?: () => void
  /** Called by `Cambiar estilo` to show the full list again. */
  onReopen?: () => void
}

/** Style of one portion as selectable cards, plus the chiles for Estilo Mexicana. */
export function StyleCards({ title, portion, styles, onChange, collapsed = false, onPick, onReopen }: StyleCardsProps) {
  const style = styles.find((candidate) => candidate.id === portion.styleId)
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{`Estilo de la ${title}`}</legend>
        {(collapsed && style ? [style] : styles).map((candidate) => {
          const selected = candidate.id === portion.styleId
          return (
            <button
              key={candidate.id}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                // Picking the style already chosen keeps its ingredients; a different one resets them.
                if (candidate.id !== portion.styleId) onChange(setPortionStyle(portion, candidate))
                onPick?.()
              }}
              className={cn(
                'flex min-h-[60px] items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors',
                selected ? 'border-2 border-red-700 bg-red-50 dark:border-red-400 dark:bg-red-950/60' : 'border-slate-300 bg-white hover:bg-slate-50',
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-bold text-slate-900">{candidate.name}</span>
                {candidate.description && <span className="break-words text-xs text-slate-500">{candidate.description}</span>}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-[26px] flex-none items-center justify-center rounded-full border-2 text-sm font-extrabold',
                  selected ? 'border-red-700 bg-red-700 text-white dark:border-red-400' : 'border-slate-300 text-transparent',
                )}
              >
                ✓
              </span>
            </button>
          )
        })}
      </fieldset>

      {collapsed && style && (
        <button
          type="button"
          onClick={onReopen}
          className="min-h-11 self-start rounded-lg px-3 text-sm font-bold text-red-700 underline underline-offset-2 hover:bg-slate-100 dark:text-red-300"
        >
          Cambiar estilo
        </button>
      )}

      {style && hasChileVariants(style) && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-slate-700">Chile (elige uno o dos)</legend>
          <div className="flex flex-wrap gap-2">
            {CHILE_VARIANTS.map((variant) => (
              <ToggleChip
                key={variant.code}
                label={variant.name}
                pressed={portion.chiles?.includes(variant.code) ?? false}
                onToggle={() => onChange(toggleChile(portion, variant.code))}
              />
            ))}
            <ToggleChip label="Los 3 chiles" pressed={!portion.chiles?.length} onToggle={() => onChange(clearChiles(portion))} />
          </div>
        </fieldset>
      )}
    </div>
  )
}
