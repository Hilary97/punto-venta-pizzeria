import { useId } from 'react'
import { MAX_EXTRA_INGREDIENTS } from '../domain/pizza'
import type { PizzaIngredient, PizzaPortion, PizzaStyle } from '../domain/pizza'
import { setPortionStyle, toggleExtra, toggleExtraCheese, toggleIngredient } from '../domain/pizzaBuilder'
import { ToggleChip } from './ToggleChip'

interface PortionEditorProps {
  title: string
  portion: PizzaPortion
  styles: PizzaStyle[]
  ingredients: PizzaIngredient[]
  onChange: (portion: PizzaPortion) => void
}

/** Style, ingredients, extras and extra cheese for one portion of the pizza. */
export function PortionEditor({ title, portion, styles, ingredients, onChange }: PortionEditorProps) {
  const styleId = useId()
  const style = styles.find((candidate) => candidate.id === portion.styleId)

  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 p-4">
      <legend className="px-1 text-base font-bold text-slate-900">{title}</legend>

      <div className="flex flex-col gap-1">
        <label htmlFor={styleId} className="text-sm font-medium text-slate-700">
          Estilo
        </label>
        <select
          id={styleId}
          value={portion.styleId}
          onChange={(event) => {
            const next = styles.find((candidate) => candidate.id === event.target.value)
            if (next) onChange(setPortionStyle(portion, next))
          }}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900"
        >
          {styles.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
        {style?.description && <p className="break-words text-sm text-slate-500">{style.description}</p>}
      </div>

      {style?.kind === 'custom' && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-slate-700">
            Ingredientes ({portion.ingredientIds.length}/{style.includedIngredients})
          </legend>
          <div className="flex flex-wrap gap-2">
            {ingredients.map((ingredient) => {
              const pressed = portion.ingredientIds.includes(ingredient.id)
              return (
                <ToggleChip
                  key={ingredient.id}
                  label={ingredient.name}
                  pressed={pressed}
                  disabled={!pressed && portion.ingredientIds.length >= style.includedIngredients}
                  onToggle={() => onChange(toggleIngredient(portion, ingredient.id, style))}
                />
              )
            })}
          </div>
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-slate-700">
          Ingredientes extra ({portion.extraIngredientIds.length}/{MAX_EXTRA_INGREDIENTS})
        </legend>
        <div className="flex flex-wrap gap-2">
          {ingredients.map((ingredient) => {
            const pressed = portion.extraIngredientIds.includes(ingredient.id)
            return (
              <ToggleChip
                key={ingredient.id}
                label={ingredient.name}
                pressed={pressed}
                disabled={!pressed && portion.extraIngredientIds.length >= MAX_EXTRA_INGREDIENTS}
                onToggle={() => onChange(toggleExtra(portion, ingredient.id))}
              />
            )
          })}
        </div>
      </fieldset>

      <div>
        <ToggleChip label="Extra queso" pressed={portion.extraCheese} onToggle={() => onChange(toggleExtraCheese(portion))} />
      </div>
    </fieldset>
  )
}
