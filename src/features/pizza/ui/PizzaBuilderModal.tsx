import { useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Button } from '../../../shared/ui/Button'
import { byName } from '../../../shared/sortByName'
import { cn } from '../../../shared/ui/cn'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { Textarea } from '../../../shared/ui/Textarea'
import { MAX_ITEM_NOTES_LENGTH } from '../../orders/domain/order'
import { MAX_PORTION_NOTE_LENGTH, describePizza, isSizeSoldOut, portionLabel, validatePizzaConfig } from '../domain/pizza'
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

const MAX_QUANTITY = 20

/** After a tap that moves the portion by itself, taps on the new content are ignored this long, so a quick double tap never picks by accident. */
export const GHOST_TAP_GUARD_MS = 150

/** Monotonic clock for the ghost-tap guard; only read from tap handlers. */
const now = () => performance.now()

function portionTitle(count: number, index: number): string {
  if (count === 1) return 'Pizza entera'
  return count === 2 ? `Mitad ${index + 1}` : `Porción ${index + 1}`
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

/** A style with nothing to choose (no included ingredients, no chiles): picking it completes its portion. */
function hasNoChoices(style: PizzaStyle | undefined): boolean {
  return style !== undefined && style.includedIngredients === 0 && !hasChileVariants(style)
}

/**
 * Builds one pizza on a single screen: size and division stay at the top, the portions are tabs and only
 * the active portion shows its styles and ingredients. There are no steps to walk through: choosing a size
 * or a style never leaves the screen, and the summary with "Agregar pizza" stays at the bottom.
 */
export function PizzaBuilderModal({ catalog, onAdd, onClose, quickPick = false, noteShortcuts = [] }: PizzaBuilderModalProps) {
  const notesId = useId()
  const tabBaseId = useId()
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
  /** Portion shown below the tabs. */
  const [activeIndex, setActiveIndex] = useState(0)
  /** Portions whose style was picked: their style list shows collapsed. */
  const [collapsed, setCollapsed] = useState<number[]>([])
  /** The notes are optional, so they stay folded until they are needed. */
  const [notesOpen, setNotesOpen] = useState(false)
  /** Style id of the latest card tap, set by the card's change handler and read by its pick handler. */
  const pickedStyleId = useRef<string | undefined>(undefined)
  /** Until when (performance.now) taps on the content reached by an automatic move are ignored. */
  const guardUntil = useRef(0)

  if (sizes.length === 0) return null

  // A sold-out size is never the current one, even if it was selected before the catalog refreshed.
  const available = sizes.filter((candidate) => !isSizeSoldOut(candidate))
  const size = available.find((candidate) => candidate.code === sizeCode)
  const noDough = available.length === 0
  const hasDivision = (size?.allowedPortions.length ?? 0) > 1

  const count = portions.length
  const index = Math.min(activeIndex, count - 1)
  const activePortion = portions[index] as PizzaPortion
  const styleOf = (portion: PizzaPortion | undefined) => styles.find((candidate) => candidate.id === portion?.styleId)
  const activeStyle = styleOf(activePortion)

  const config = buildConfig(size?.code ?? sizeCode ?? 'chica', portions, extraIds)
  const errors = size ? validatePizzaConfig(config, catalog) : []
  const description = size ? describePizza(config, catalog) : ''
  // A portion without a style fails validation with a generic message; the waiter gets the useful one instead.
  const missingIndex = portions.findIndex((portion) => !hasStyle(portion))
  const missingStyleHint = missingIndex === -1 ? null : `Elige el estilo de ${missingStyleTarget(count, missingIndex)}`
  const visibleErrors = size ? (missingStyleHint !== null ? [missingStyleHint] : errors) : []
  const blocked = size === undefined || noDough || missingStyleHint !== null || errors.length > 0

  /** Swallows a tap that lands on the new content right after an automatic move (the second half of a double tap). */
  function ignoreGhostTap(event: { preventDefault(): void; stopPropagation(): void }) {
    if (now() >= guardUntil.current) return
    event.preventDefault()
    event.stopPropagation()
  }

  function selectSize(code: PizzaSizeCode) {
    const next = sizes.find((candidate) => candidate.code === code)
    if (!next) return
    // Tapping the size already selected keeps everything chosen.
    if (code !== size?.code) {
      setSizeCode(code)
      setCollapsed([])
      setActiveIndex(0)
      setPortions((existing) => resizePortions(existing, next))
    }
    // The content below appears with the tap: a quick second tap must not pick a division or a style.
    guardUntil.current = now() + GHOST_TAP_GUARD_MS
  }

  function selectDivision(next: number) {
    setCollapsed([])
    // Keeps what was already chosen; new portions start without a style.
    setPortions((existing) => {
      const fresh = initialPortions(next)
      return fresh.map((portion, i) => existing[i] ?? portion)
    })
    setActiveIndex((current) => Math.min(current, next - 1))
  }

  function updatePortion(at: number, portion: PizzaPortion) {
    setPortions((existing) => existing.map((candidate, i) => (i === at ? portion : candidate)))
  }

  /** After a style card tap: a style with nothing to choose moves to the next portion by itself. */
  function pickStyle(at: number) {
    const styleId = pickedStyleId.current ?? portions[at]?.styleId
    pickedStyleId.current = undefined
    setCollapsed((existing) => (existing.includes(at) ? existing : [...existing, at]))
    if (at < count - 1 && hasNoChoices(styles.find((candidate) => candidate.id === styleId))) {
      guardUntil.current = now() + GHOST_TAP_GUARD_MS
      setActiveIndex(at + 1)
    }
  }

  /** Arrow keys, Home and End move between the portion tabs, as the tabs pattern expects. */
  function moveTab(event: KeyboardEvent<HTMLDivElement>) {
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % count
        : event.key === 'ArrowLeft'
          ? (index - 1 + count) % count
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : null
    if (target === null) return
    event.preventDefault()
    setActiveIndex(target)
    document.getElementById(`${tabBaseId}-tab-${target}`)?.focus()
  }

  function addPizzas() {
    if (blocked) return
    const pizza: BuiltPizza = { config, name: description, notes }
    for (let i = 0; i < quantity; i++) onAdd(pizza)
    onClose()
  }

  const summaryParts = portions
    .map((portion, at) => {
      const word = count > 1 ? `${portionWord(count)} ` : ''
      if (styleOf(portion)) return `${word}${shortStyle(styleOf(portion))}`
      return count > 1 ? `${word}${at + 1} sin estilo` : ''
    })
    .filter((part) => part !== '')
  const extraNames = extras.filter((extra) => extraIds.includes(extra.id)).map((extra) => extra.name)
  const summary = [summaryParts.join(' / '), ...(extraNames.length > 0 ? [extraNames.join(', ')] : [])].join(' · ')
  const diagramLabel =
    count === 1 ? 'Pizza entera' : `Pizza dividida en ${portionLabel(count)}; ${portionTitle(count, index)} seleccionada`

  return (
    <Modal title="Armar pizza" onClose={onClose} wide>
      {/* touch-manipulation: no double-tap zoom or tap delay on phones, so taps register at once. */}
      <div className="flex min-w-0 touch-manipulation flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold text-slate-900 md:text-base">Tamaño</legend>
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

        {size && (
          <div className="contents" onClickCapture={ignoreGhostTap}>
            {hasDivision && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-bold text-slate-900 md:text-base">División</legend>
                <div className="flex flex-wrap gap-2">
                  {size.allowedPortions.map((option) => (
                    <ToggleChip key={option} label={portionLabel(option)} pressed={count === option} onToggle={() => selectDivision(option)} />
                  ))}
                </div>
              </fieldset>
            )}

            {count > 1 && (
              <div
                role="tablist"
                aria-label="Porciones de la pizza"
                onKeyDown={moveTab}
                className="grid gap-1 rounded-xl bg-slate-100 p-1"
                style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
              >
                {portions.map((portion, at) => {
                  const chosen = styleOf(portion)
                  return (
                    <button
                      key={at}
                      id={`${tabBaseId}-tab-${at}`}
                      type="button"
                      role="tab"
                      aria-selected={at === index}
                      aria-controls={`${tabBaseId}-panel`}
                      tabIndex={at === index ? 0 : -1}
                      onClick={() => setActiveIndex(at)}
                      className={cn(
                        'flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 lg:min-h-16',
                        at === index ? 'bg-white shadow-sm' : 'text-slate-600',
                      )}
                    >
                      <b className={cn('text-sm font-bold', at === index ? 'text-red-800 dark:text-red-300' : 'text-slate-900')}>
                        {portionTitle(count, at)}
                      </b>
                      <span
                        className={cn(
                          'w-full break-words text-center text-xs font-semibold leading-tight',
                          chosen ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300',
                        )}
                      >
                        {chosen ? shortStyle(chosen) : 'Sin estilo'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            <div
              id={`${tabBaseId}-panel`}
              role={count > 1 ? 'tabpanel' : undefined}
              aria-labelledby={count > 1 ? `${tabBaseId}-tab-${index}` : undefined}
              className="flex flex-col gap-3"
            >
              <div className="flex items-center gap-3">
                <PizzaDiagram count={count} index={index} label={diagramLabel} />
                <p className="text-sm text-slate-500">
                  <strong className="block text-base text-slate-900">{portionTitle(count, index)}</strong>
                  {activeStyle ? shortStyle(activeStyle) : 'Elige el estilo'}
                </p>
              </div>

              <div className="grid gap-3 lg:grid-cols-2 lg:items-start lg:gap-6">
                <StyleCards
                  title={portionTitle(count, index)}
                  portion={activePortion}
                  styles={styles}
                  onChange={(portion) => {
                    pickedStyleId.current = portion.styleId
                    updatePortion(index, portion)
                  }}
                  collapsed={collapsed.includes(index)}
                  onPick={() => pickStyle(index)}
                  onReopen={() => setCollapsed((existing) => existing.filter((at) => at !== index))}
                />

                {activeStyle ? (
                  <PortionEditor
                    portion={activePortion}
                    style={activeStyle}
                    ingredients={ingredients}
                    onChange={(portion) => updatePortion(index, portion)}
                  />
                ) : (
                  <p className="hidden rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 lg:block">
                    Elige un estilo para ajustar sus ingredientes.
                  </p>
                )}
              </div>
            </div>

            {!quickPick && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  aria-expanded={notesOpen}
                  onClick={() => setNotesOpen((open) => !open)}
                  className="flex min-h-11 items-center justify-between rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900"
                >
                  <span>Notas</span>
                  <span aria-hidden="true" className="text-slate-500">
                    {notesOpen ? '▴' : '▾'}
                  </span>
                </button>
                {notesOpen && (
                  <div className="flex flex-col gap-3">
                    {count > 1 &&
                      portions.map((portion, at) => {
                        const styleName = shortStyle(styleOf(portion))
                        const title = portionTitle(count, at)
                        const label = styleName ? `${title} · ${styleName}` : title
                        return (
                          <div key={at} className="flex flex-col gap-1">
                            <Input
                              id={`${notesId}-portion-${at}`}
                              label={label}
                              value={portion.note ?? ''}
                              maxLength={MAX_PORTION_NOTE_LENGTH}
                              placeholder="Nota (opcional)"
                              onChange={(event) => updatePortion(at, { ...portion, note: event.target.value })}
                            />
                            <NoteShortcutChips
                              label={label}
                              shortcuts={noteShortcuts}
                              note={portion.note ?? ''}
                              maxLength={MAX_PORTION_NOTE_LENGTH}
                              onChange={(note) => updatePortion(at, { ...portion, note })}
                            />
                          </div>
                        )
                      })}
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
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Whole-pizza extras close the screen, after the chosen portion and its ingredients. */}
        {extras.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-bold text-slate-900 md:text-base">Extras para toda la pizza</legend>
            <div className="flex flex-col gap-2 md:grid md:grid-cols-2">
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
            </div>
          </fieldset>
        )}

        <div className="sticky -bottom-6 -mx-6 -mb-6 flex flex-col gap-2 border-t border-slate-300 bg-white px-6 pb-4 pt-3 shadow-[0_-6px_16px_rgba(15,23,42,0.08)]">
          {!noDough && (
            <div role="status" aria-label="Resumen de la pizza" aria-live="polite" className="text-sm text-slate-500 md:text-base">
              {size ? (
                <>
                  <b className="break-words text-slate-900">{`Pizza ${size.name}`}</b>
                  {summary ? ` · ${summary}` : ''}
                </>
              ) : (
                <b className="text-slate-900">Elige el tamaño</b>
              )}
              {visibleErrors.length > 0 && (
                <ul className="list-disc pl-5 text-amber-700 dark:text-amber-300">
                  {visibleErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
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
            <Button size="lg" className="flex-1 md:min-h-14 md:text-xl" disabled={blocked} onClick={addPizzas}>
              {quickPick ? 'Fijar pizza' : 'Agregar pizza'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
