import { useId } from 'react'
import { cn } from '../../../shared/ui/cn'
import type { PizzaIngredient, PizzaPortion, PizzaStyle } from '../domain/pizza'
import { ingredientLevel, isChargedIngredient, setIngredientLevel } from '../domain/pizzaBuilder'
import type { IngredientLevel } from '../domain/pizzaBuilder'
import { ToggleChip } from './ToggleChip'

interface PortionEditorProps {
  portion: PizzaPortion
  style: PizzaStyle
  ingredients: PizzaIngredient[]
  onChange: (portion: PizzaPortion) => void
}

const LEVELS: { level: IngredientLevel; label: 'Normal' | 'Doble' | 'Quitar' }[] = [
  { level: 'normal', label: 'Normal' },
  { level: 'doble', label: 'Doble' },
  { level: 'none', label: 'Quitar' },
]

function legend(style: PizzaStyle): string {
  const count = style.includedIngredients
  if (count === 0) return 'Este estilo no incluye ingredientes a elección · Todo ingrediente que agregues cuenta como extra'
  const noun = count === 1 ? 'ingrediente' : 'ingredientes'
  return `Incluye ${count} ${noun} a elección · Doble cuenta como extra`
}

/** Ingredients of one portion: one chip list, and a Normal / Doble / Quitar control per chosen ingredient. */
export function PortionEditor({ portion, style, ingredients, onChange }: PortionEditorProps) {
  const headingId = useId()
  const chosen = ingredients.filter((ingredient) => ingredientLevel(portion, ingredient.id) !== 'none')
  const full = portion.ingredientIds.length >= style.includedIngredients

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-xl border border-amber-600 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 dark:border-amber-500 dark:bg-amber-950/60 dark:text-amber-200">{legend(style)}</p>
      {style.includedIngredients > 0 && (
        <p aria-live="polite" className="text-xs text-slate-500">
          Ingredientes incluidos: {portion.ingredientIds.length}/{style.includedIngredients}
        </p>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-bold text-slate-900">Elige ingredientes</legend>
        <div role="group" aria-label="Ingredientes disponibles" className="flex flex-wrap gap-2">
          {ingredients.map((ingredient) => {
            const picked = ingredientLevel(portion, ingredient.id) !== 'none'
            return (
              <ToggleChip
                key={ingredient.id}
                label={ingredient.name}
                pressed={picked}
                hint={!picked && style.includedIngredients > 0 && full ? 'Extra' : undefined}
                onToggle={() => onChange(setIngredientLevel(portion, ingredient.id, picked ? 'none' : 'normal', style))}
              />
            )
          })}
        </div>
      </fieldset>

      {chosen.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 id={headingId} className="text-sm font-bold text-slate-900">
            Ajusta cada ingrediente
          </h4>
          <ul aria-labelledby={headingId} className="flex flex-col gap-2">
            {chosen.map((ingredient) => {
              const current = ingredientLevel(portion, ingredient.id)
              return (
                <li key={ingredient.id} className="flex min-h-[52px] items-center gap-2 rounded-xl border border-slate-200 bg-white py-1 pl-3 pr-1">
                  <span className="min-w-0 flex-1 text-sm font-bold text-slate-900">
                    {ingredient.name}
                    {isChargedIngredient(portion, ingredient.id) && <span className="block text-xs font-medium text-amber-700 dark:text-amber-300">Extra</span>}
                  </span>
                  <div role="group" aria-label={`Cantidad de ${ingredient.name}`} className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
                    {LEVELS.map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        aria-pressed={option.level !== 'none' && option.level === current}
                        onClick={() => onChange(setIngredientLevel(portion, ingredient.id, option.level, style))}
                        className={cn(
                          'min-h-11 min-w-14 rounded-md px-1.5 text-sm font-bold',
                          option.level !== 'none' && option.level === current ? 'bg-red-700 text-white' : 'text-slate-600 hover:bg-slate-200',
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
