import { useId, useMemo, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Modal } from '../../../shared/ui/Modal'
import { Textarea } from '../../../shared/ui/Textarea'
import { MAX_ITEM_NOTES_LENGTH } from '../../orders/domain/order'
import { describePizza, portionLabel, validatePizzaConfig } from '../domain/pizza'
import type { PizzaCatalog, PizzaConfig, PizzaPortion, PizzaSizeCode } from '../domain/pizza'
import { buildConfig, initialPortions, resizePortions } from '../domain/pizzaBuilder'
import { PortionEditor } from './PortionEditor'
import { ToggleChip } from './ToggleChip'

export interface BuiltPizza {
  config: PizzaConfig
  /** Same description the server stores, shown on the draft line. */
  name: string
  notes: string
}

interface PizzaBuilderModalProps {
  catalog: PizzaCatalog
  onAdd: (pizza: BuiltPizza) => void
  onClose: () => void
}

function portionTitle(count: number, index: number): string {
  if (count === 1) return 'Pizza entera'
  return count === 2 ? `Mitad ${index + 1}` : `Porción ${index + 1}`
}

export function PizzaBuilderModal({ catalog, onAdd, onClose }: PizzaBuilderModalProps) {
  const notesId = useId()
  const sizes = useMemo(() => [...catalog.sizes].sort((a, b) => a.sortOrder - b.sortOrder), [catalog.sizes])
  const styles = useMemo(() => [...catalog.styles].sort((a, b) => a.sortOrder - b.sortOrder), [catalog.styles])
  const ingredients = useMemo(
    () => [...catalog.ingredients].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [catalog.ingredients],
  )
  const defaultStyleId = (styles.find((style) => style.kind === 'special') ?? styles[0])?.id ?? ''

  const [sizeCode, setSizeCode] = useState<PizzaSizeCode>(sizes[0]?.code ?? 'chica')
  const [portions, setPortions] = useState<PizzaPortion[]>(() => initialPortions(1, defaultStyleId))
  const [notes, setNotes] = useState('')

  const size = sizes.find((candidate) => candidate.code === sizeCode) ?? sizes[0]
  if (!size) return null

  const config = buildConfig(size.code, portions)
  const errors = validatePizzaConfig(config, catalog)
  const description = describePizza(config, catalog)

  function selectSize(code: PizzaSizeCode) {
    const next = sizes.find((candidate) => candidate.code === code)
    if (!next) return
    setSizeCode(code)
    setPortions((current) => resizePortions(current, next, defaultStyleId))
  }

  function selectDivision(count: number) {
    // Keeps what was already chosen; new portions start with the first portion's style.
    setPortions((current) => {
      const fresh = initialPortions(count, current[0]?.styleId ?? defaultStyleId)
      return fresh.map((portion, index) => current[index] ?? portion)
    })
  }

  function updatePortion(index: number, portion: PizzaPortion) {
    setPortions((current) => current.map((candidate, i) => (i === index ? portion : candidate)))
  }

  return (
    <Modal title="Armar pizza" onClose={onClose} wide>
      <div className="flex min-w-0 flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-slate-700">Tamaño</legend>
          <div className="flex flex-wrap gap-2">
            {sizes.map((candidate) => (
              <ToggleChip
                key={candidate.code}
                label={candidate.name}
                pressed={candidate.code === size.code}
                onToggle={() => selectSize(candidate.code)}
              />
            ))}
          </div>
        </fieldset>

        {size.allowedPortions.length > 1 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-slate-700">División</legend>
            <div className="flex flex-wrap gap-2">
              {size.allowedPortions.map((count) => (
                <ToggleChip
                  key={count}
                  label={portionLabel(count)}
                  pressed={portions.length === count}
                  onToggle={() => selectDivision(count)}
                />
              ))}
            </div>
          </fieldset>
        )}

        {portions.map((portion, index) => (
          <PortionEditor
            key={index}
            title={portionTitle(portions.length, index)}
            portion={portion}
            styles={styles}
            ingredients={ingredients}
            onChange={(next) => updatePortion(index, next)}
          />
        ))}

        <Textarea
          id={notesId}
          label="Nota de la pizza (opcional)"
          value={notes}
          maxLength={MAX_ITEM_NOTES_LENGTH}
          onChange={(event) => setNotes(event.target.value)}
        />

        <div className="flex flex-col gap-1 rounded-xl bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-500">Resumen</p>
          <p className="break-words font-semibold text-slate-900">{description}</p>
          {errors.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-amber-700">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </div>

        <Button size="lg" disabled={errors.length > 0} onClick={() => onAdd({ config, name: description, notes })}>
          Agregar pizza
        </Button>
      </div>
    </Modal>
  )
}
