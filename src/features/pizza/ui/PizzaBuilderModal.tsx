import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { byName } from '../../../shared/sortByName'
import { cn } from '../../../shared/ui/cn'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { Textarea } from '../../../shared/ui/Textarea'
import { MAX_ITEM_NOTES_LENGTH } from '../../orders/domain/order'
import { MAX_PORTION_NOTE_LENGTH, describePizza, isSizeSoldOut, portionLabel, validatePizzaConfig, validatePortion } from '../domain/pizza'
import type { PizzaCatalog, PizzaConfig, PizzaPortion, PizzaSize, PizzaSizeCode, PizzaStyle } from '../domain/pizza'
import { buildConfig, hasChileVariants, hasStyle, initialPortions, resizePortions, sortBuilderStyles, togglePizzaExtra } from '../domain/pizzaBuilder'
import { NoteShortcutChips } from './NoteShortcutChips'
import { PizzaDiagram } from './PizzaDiagram'
import { PortionEditor } from './PortionEditor'
import { StyleCards } from './StyleCards'
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
  /** Admin quick pizzas: one pizza without quantity or note, added with "Fijar pizza". */
  quickPick?: boolean
  /** Admin-managed note shortcuts, shown as chips under each note field. */
  noteShortcuts?: string[]
}

type Step = { kind: 'size' } | { kind: 'portion'; index: number }

const MAX_QUANTITY = 20

/** Pause between a tap that moves on by itself and the move, so the waiter sees what was pressed. */
export const AUTO_ADVANCE_MS = 200

function portionTitle(count: number, index: number): string {
  if (count === 1) return 'Pizza entera'
  return count === 2 ? `Mitad ${index + 1}` : `Porción ${index + 1}`
}

/** Short step name: `Pizza` for a whole pizza, otherwise the portion title. */
function portionStepName(count: number, index: number): string {
  return count === 1 ? 'Pizza' : portionTitle(count, index)
}

/** `la pizza`, `la mitad 1`, `la porción 3` for the missing-style hint. */
function missingStyleTarget(count: number, index: number): string {
  return count === 1 ? 'la pizza' : `la ${portionTitle(count, index).toLowerCase()}`
}

/** `Mitad`, `Tercio`, `Cuarto` for the live summary. */
function portionWord(count: number): string {
  return count === 2 ? 'Mitad' : count === 3 ? 'Tercio' : 'Cuarto'
}

function shortStyle(style: PizzaStyle | undefined): string {
  return (style?.name ?? '').replace(/^Estilo /, '')
}

function sizeHint(size: PizzaSize): string | undefined {
  if (isSizeSoldOut(size)) return 'Agotado'
  return size.doughLeft === null ? undefined : `Quedan ${size.doughLeft}`
}

function sameStep(a: Step, b: Step): boolean {
  return a.kind === b.kind && (a.kind !== 'portion' || (b.kind === 'portion' && a.index === b.index))
}

/** A style with nothing to choose (no included ingredients, no chiles): picking it completes its portion. */
function hasNoChoices(style: PizzaStyle | undefined): boolean {
  return style !== undefined && style.includedIngredients === 0 && !hasChileVariants(style)
}

export function PizzaBuilderModal({ catalog, onAdd, onClose, quickPick = false, noteShortcuts = [] }: PizzaBuilderModalProps) {
  const notesId = useId()
  const sizes = useMemo(() => [...catalog.sizes].sort((a, b) => a.sortOrder - b.sortOrder), [catalog.sizes])
  const styles = useMemo(() => sortBuilderStyles(catalog.styles), [catalog.styles])
  const ingredients = useMemo(() => [...catalog.ingredients].sort(byName), [catalog.ingredients])
  const extras = useMemo(() => [...catalog.extras].sort(byName), [catalog.extras])

  /** No size is marked on open, so the waiter notices the tap. */
  const [sizeCode, setSizeCode] = useState<PizzaSizeCode | null>(null)
  const [portions, setPortions] = useState<PizzaPortion[]>(() => initialPortions(1))
  const [extraIds, setExtraIds] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [step, setStep] = useState<Step>({ kind: 'size' })
  /** Portions whose style was picked: their style list shows collapsed. */
  const [collapsed, setCollapsed] = useState<number[]>([])
  /** Style id of the latest card tap, set by the card's change handler and read by its pick handler. */
  const pickedStyleId = useRef<string | undefined>(undefined)
  /** The one pending automatic advance; a new tap replaces it and leaving cancels it. */
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  function cancelAdvance() {
    if (advanceTimer.current === undefined) return
    clearTimeout(advanceTimer.current)
    advanceTimer.current = undefined
  }

  function scheduleAdvance(target: Step) {
    cancelAdvance()
    advanceTimer.current = setTimeout(() => {
      advanceTimer.current = undefined
      setStep(target)
    }, AUTO_ADVANCE_MS)
  }

  useEffect(() => cancelAdvance, [])

  if (sizes.length === 0) return null

  // A sold-out size is never the current one, even if it was selected before the catalog refreshed.
  const available = sizes.filter((candidate) => !isSizeSoldOut(candidate))
  const size = available.find((candidate) => candidate.code === sizeCode)
  const noDough = available.length === 0
  const hasDivision = (size?.allowedPortions.length ?? 0) > 1

  const config = buildConfig(size?.code ?? sizeCode ?? 'chica', portions, extraIds)
  const errors = size ? validatePizzaConfig(config, catalog) : []
  const description = size ? describePizza(config, catalog) : ''

  const flow: Step[] = [
    { kind: 'size' },
    ...portions.map((_, index) => ({ kind: 'portion', index }) as const),
  ]
  const position = Math.max(0, flow.findIndex((candidate) => sameStep(candidate, step)))
  // Without a (still available) size only the size step makes sense.
  const current = (size ? flow[position] : flow[0]) as Step
  const previous = size ? flow[position - 1] : undefined
  const following = flow[position + 1]
  const count = portions.length
  const isLast = current.kind === 'portion' && current.index === count - 1

  function stepName(target: Step | undefined): string {
    if (!target) return ''
    if (target.kind === 'size') return 'Tamaño'
    return portionStepName(count, target.index)
  }

  function selectSize(code: PizzaSizeCode) {
    const next = sizes.find((candidate) => candidate.code === code)
    if (!next) return
    // Tapping the size already selected keeps everything chosen and just moves on.
    if (code !== size?.code) {
      setSizeCode(code)
      setCollapsed([])
      setPortions((existing) => resizePortions(existing, next))
    }
    scheduleAdvance({ kind: 'portion', index: 0 })
  }

  function selectDivision(next: number) {
    setCollapsed([])
    // Keeps what was already chosen; new portions start without a style.
    setPortions((existing) => {
      const fresh = initialPortions(next)
      return fresh.map((portion, index) => existing[index] ?? portion)
    })
  }

  function updatePortion(index: number, portion: PizzaPortion) {
    setPortions((existing) => existing.map((candidate, i) => (i === index ? portion : candidate)))
  }

  /** After a style card tap: a style with nothing to choose moves to the next portion (the last one stays). */
  function pickStyle(index: number) {
    const styleId = pickedStyleId.current ?? portions[index]?.styleId
    pickedStyleId.current = undefined
    cancelAdvance()
    setCollapsed((existing) => (existing.includes(index) ? existing : [...existing, index]))
    if (index < count - 1 && hasNoChoices(styles.find((candidate) => candidate.id === styleId))) scheduleAdvance({ kind: 'portion', index: index + 1 })
  }

  function goTo(target: Step | undefined) {
    if (!target) return
    cancelAdvance()
    setStep(target)
  }

  function closeBuilder() {
    cancelAdvance()
    onClose()
  }

  function addPizzas() {
    if (noDough || errors.length > 0) return
    const pizza: BuiltPizza = { config, name: description, notes }
    for (let i = 0; i < quantity; i++) onAdd(pizza)
    closeBuilder()
  }

  const styleOf = (portion: PizzaPortion | undefined) => styles.find((candidate) => candidate.id === portion?.styleId)
  const summaryParts = portions
    .map((portion, index) => {
      const word = count > 1 ? `${portionWord(count)} ` : ''
      if (styleOf(portion)) return `${word}${shortStyle(styleOf(portion))}`
      return count > 1 ? `${word}${index + 1} sin estilo` : ''
    })
    .filter((part) => part !== '')
  const extraNames = extras.filter((extra) => extraIds.includes(extra.id)).map((extra) => extra.name)
  const summary = [summaryParts.join(' / '), ...(extraNames.length > 0 ? [extraNames.join(', ')] : [])].join(' · ')

  const headerItems = [
    { label: 'Tamaño', value: size?.name ?? '', state: current.kind === 'size' ? 'cur' : 'done' },
    ...portions.map((portion, index) => ({
      label: portionStepName(count, index),
      value: shortStyle(styleOf(portion)),
      state: current.kind === 'portion' ? (current.index === index ? 'cur' : current.index > index ? 'done' : 'todo') : 'todo',
    })),
  ] as const

  const portionIndex = current.kind === 'portion' ? current.index : 0
  const activePortion = portions[portionIndex] as PizzaPortion
  const activeStyle = styleOf(activePortion)
  // On the last step the first portion still missing its style is the one to point at.
  const missingIndex = isLast ? portions.findIndex((portion) => !hasStyle(portion)) : hasStyle(activePortion) ? -1 : portionIndex
  const missingStyleHint = missingIndex === -1 ? null : `Elige el estilo de ${missingStyleTarget(count, missingIndex)}`
  const portionError = current.kind === 'portion' ? (missingStyleHint ?? validatePortion(activePortion, catalog)) : null
  const stepErrors = missingStyleHint ? [missingStyleHint] : isLast ? errors : portionError ? [portionError] : []
  const diagramLabel =
    count === 1 ? 'Pizza entera' : `Pizza dividida en ${portionLabel(count)}; ${portionTitle(count, portionIndex)} seleccionada`

  return (
    <Modal title="Armar pizza" onClose={closeBuilder} wide>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center">
          {previous ? (
            <Button variant="ghost" size="md" onClick={() => goTo(previous)}>
              {`← ${stepName(previous)}`}
            </Button>
          ) : (
            <Button variant="ghost" size="md" onClick={closeBuilder}>
              ← Cancelar pizza
            </Button>
          )}
        </div>

        <ol aria-label="Pasos de la pizza" className="grid list-none gap-1 p-0" style={{ gridTemplateColumns: `repeat(${headerItems.length}, minmax(0, 1fr))` }}>
          {headerItems.map((item) => (
            <li
              key={item.label}
              aria-current={item.state === 'cur' ? 'step' : undefined}
              className={cn(
                'min-w-0 break-words border-t-4 pt-1 text-xs leading-tight text-slate-500',
                item.state === 'done' && 'border-emerald-600 dark:border-emerald-400',
                item.state === 'cur' && 'border-red-700 dark:border-red-400',
                item.state === 'todo' && 'border-slate-300',
              )}
            >
              <b className={cn('block', item.state === 'done' && 'text-emerald-700 dark:text-emerald-300', item.state === 'cur' && 'text-red-800 dark:text-red-300', item.state === 'todo' && 'text-slate-900')}>
                {item.label}
                {item.state === 'done' ? ' ✓' : ''}
              </b>
              {item.value}
            </li>
          ))}
        </ol>

        {current.kind === 'size' && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-slate-700">Tamaño</legend>
            <div className="flex flex-wrap gap-2">
              {sizes.map((candidate) => (
                <ToggleChip
                  key={candidate.code}
                  label={candidate.name}
                  pressed={candidate.code === size?.code}
                  disabled={isSizeSoldOut(candidate)}
                  hint={sizeHint(candidate)}
                  onToggle={() => selectSize(candidate.code)}
                />
              ))}
            </div>
            {noDough && <p className="font-semibold text-amber-700 dark:text-amber-300">No hay masas de pizza disponibles.</p>}
          </fieldset>
        )}

        {current.kind === 'portion' && (
          <>
            <div className="flex items-center gap-3">
              <PizzaDiagram count={count} index={current.index} label={diagramLabel} />
              <p className="text-sm text-slate-500">
                <strong className="block text-base text-slate-900">{portionTitle(count, current.index)}</strong>
                Elige el estilo
              </p>
            </div>
            {current.index === 0 && hasDivision && size && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium text-slate-700">División</legend>
                <div className="flex flex-wrap gap-2">
                  {size.allowedPortions.map((option) => (
                    <ToggleChip
                      key={option}
                      label={portionLabel(option)}
                      pressed={count === option}
                      onToggle={() => selectDivision(option)}
                    />
                  ))}
                </div>
              </fieldset>
            )}
            <StyleCards
              title={portionTitle(count, current.index)}
              portion={activePortion}
              styles={styles}
              onChange={(portion) => {
                pickedStyleId.current = portion.styleId
                updatePortion(current.index, portion)
              }}
              collapsed={collapsed.includes(current.index)}
              onPick={() => pickStyle(current.index)}
              onReopen={() => setCollapsed((existing) => existing.filter((index) => index !== current.index))}
            />

            {activeStyle && (
              <PortionEditor
                portion={activePortion}
                style={activeStyle}
                ingredients={ingredients}
                onChange={(portion) => updatePortion(current.index, portion)}
              />
            )}

            {isLast && extras.length > 0 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-bold text-slate-900">Extras para toda la pizza</legend>
                {extras.map((extra) => (
                  <label
                    key={extra.id}
                    className="flex min-h-12 items-center justify-between rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900"
                  >
                    {extra.name}
                    <input
                      type="checkbox"
                      checked={extraIds.includes(extra.id)}
                      onChange={() => setExtraIds((existing) => togglePizzaExtra(existing, extra.id))}
                      className="size-6 accent-red-700"
                    />
                  </label>
                ))}
              </fieldset>
            )}

            {isLast && !quickPick && count > 1 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-bold text-slate-900">Notas por porción</legend>
                {portions.map((portion, index) => {
                  const styleName = shortStyle(styleOf(portion))
                  const title = portionTitle(count, index)
                  const label = styleName ? `${title} · ${styleName}` : title
                  return (
                    <div key={index} className="flex flex-col gap-1">
                      <Input
                        id={`${notesId}-portion-${index}`}
                        label={label}
                        value={portion.note ?? ''}
                        maxLength={MAX_PORTION_NOTE_LENGTH}
                        placeholder="Nota (opcional)"
                        onChange={(event) => updatePortion(index, { ...portion, note: event.target.value })}
                      />
                      <NoteShortcutChips
                        label={label}
                        shortcuts={noteShortcuts}
                        note={portion.note ?? ''}
                        maxLength={MAX_PORTION_NOTE_LENGTH}
                        onChange={(note) => updatePortion(index, { ...portion, note })}
                      />
                    </div>
                  )
                })}
              </fieldset>
            )}

            {isLast && !quickPick && (
              <div className="flex flex-col gap-1">
                <Textarea
                  id={notesId}
                  label="Nota de la pizza (opcional)"
                  value={notes}
                  maxLength={MAX_ITEM_NOTES_LENGTH}
                  onChange={(event) => setNotes(event.target.value)}
                />
                <NoteShortcutChips
                  label="notas de la pizza"
                  shortcuts={noteShortcuts}
                  note={notes}
                  maxLength={MAX_ITEM_NOTES_LENGTH}
                  onChange={setNotes}
                />
              </div>
            )}
          </>
        )}

        <div className="sticky -bottom-6 -mx-6 -mb-6 flex flex-col gap-2 border-t border-slate-300 bg-white px-6 pb-4 pt-3 shadow-[0_-6px_16px_rgba(15,23,42,0.08)]">
          {!noDough && (
            <div role="status" aria-label="Resumen de la pizza" aria-live="polite" className="text-sm text-slate-500">
              {size ? (
                <>
                  <b className="break-words text-slate-900">{`Pizza ${size.name}`}</b>
                  {summary ? ` · ${summary}` : ''}
                </>
              ) : (
                <b className="text-slate-900">Elige el tamaño</b>
              )}
              {current.kind === 'portion' && stepErrors.length > 0 && (
                <ul className="list-disc pl-5 text-amber-700 dark:text-amber-300">
                  {stepErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {isLast ? (
            <div className="flex items-center gap-3">
              {!quickPick && (
              <div role="group" aria-label="Cantidad de pizzas" className="flex w-36 flex-none items-center justify-between rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  aria-label="Menos"
                  disabled={quantity <= 1}
                  onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                  className="min-h-11 min-w-11 rounded-lg text-xl font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                >
                  −
                </button>
                <output aria-live="polite" className="font-bold text-slate-900">{`×${quantity}`}</output>
                <button
                  type="button"
                  aria-label="Más"
                  disabled={quantity >= MAX_QUANTITY}
                  onClick={() => setQuantity((value) => Math.min(MAX_QUANTITY, value + 1))}
                  className="min-h-11 min-w-11 rounded-lg text-xl font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                >
                  +
                </button>
              </div>
              )}
              <Button size="lg" className="flex-1" disabled={noDough || errors.length > 0 || missingStyleHint !== null} onClick={addPizzas}>
                {quickPick ? 'Fijar pizza' : 'Agregar pizza'}
              </Button>
            </div>
          ) : current.kind === 'portion' ? (
            <Button size="lg" disabled={noDough || portionError !== null} onClick={() => goTo(following)}>
              {`Siguiente: ${stepName(following)} →`}
            </Button>
          ) : !size ? (
            <Button size="lg" disabled>
              {quickPick ? 'Fijar pizza' : 'Agregar pizza'}
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
