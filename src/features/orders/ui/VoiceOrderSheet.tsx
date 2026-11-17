import { useId, useState } from 'react'
import type { PizzaCatalog, PizzaConfig } from '../../pizza/domain/pizza'
import { Button } from '../../../shared/ui/Button'
import { Modal } from '../../../shared/ui/Modal'
import { Textarea } from '../../../shared/ui/Textarea'
import { cn } from '../../../shared/ui/cn'
import { productLineLabel } from '../domain/order'
import { parseSpokenOrder, type VoiceLine } from '../domain/voiceOrder'

/** The product shape the interpreter needs, without prices (S3). */
export interface VoiceProduct {
  id: string
  name: string
  variants: string[]
}

/** A complete line handed to the draft, already resolved to a product or a whole pizza. */
export type VoiceConfirmedLine =
  | { kind: 'product'; productId: string; name: string; variant: string | null; quantity: number; notes: string }
  | { kind: 'pizza'; pizza: PizzaConfig; name: string; quantity: number; notes: string }

interface VoiceOrderSheetProps {
  open: boolean
  products: VoiceProduct[]
  pizzaCatalog: PizzaCatalog
  /** Called only by Agregar al pedido, with the complete lines in the shown order. */
  onAdd: (lines: VoiceConfirmedLine[]) => void
  onClose: () => void
}

const EMPTY_HINT = 'Escribe o dicta el pedido y presiona Interpretar.'

/** Display name of a row; a pickProduct row shows what was heard until one option is chosen. */
function rowName(line: VoiceLine, choices: Record<number, string>, index: number): string {
  switch (line.kind) {
    case 'product':
      return productLineLabel(line.name, line.variant)
    case 'pizza':
      return line.name
    case 'pickProduct':
      return line.options.find((option) => option.productId === choices[index])?.name ?? line.heard
    case 'missingVariant':
      return productLineLabel(line.name, choices[index] ?? null)
    case 'unknown':
      return line.heard
  }
}

function chipClasses(selected: boolean): string {
  return cn(
    'min-h-12 rounded-full border px-4 text-sm font-semibold shadow-sm',
    selected ? 'border-red-700 bg-red-700 text-white hover:bg-red-800' : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-100',
  )
}

/** Variants of the product picked in a pickProduct row, or none when nothing (or a variant-less product) is picked. */
function variantOptionsFor(line: VoiceLine, choices: Record<number, string>, products: VoiceProduct[], index: number): string[] {
  if (line.kind !== 'pickProduct') return []
  const productId = line.options.find((option) => option.productId === choices[index])?.productId
  return products.find((product) => product.id === productId)?.variants ?? []
}

/**
 * Confirmation screen for a dictated order (S10): shows the interpreted proposed lines with
 * pending decisions, and only Agregar al pedido hands the complete lines to the draft.
 */
export function VoiceOrderSheet({ open, products, pizzaCatalog, onAdd, onClose }: VoiceOrderSheetProps) {
  const fieldId = useId()
  const [text, setText] = useState('')
  const [lines, setLines] = useState<VoiceLine[] | null>(null)
  const [quantities, setQuantities] = useState<Record<number, number>>({})
  const [choices, setChoices] = useState<Record<number, string>>({})
  // Variant picked inside a pickProduct row, kept apart from the product choice it belongs to.
  const [variantChoices, setVariantChoices] = useState<Record<number, string>>({})

  if (!open) return null

  function quantityOf(line: VoiceLine, index: number): number {
    if (line.kind === 'unknown') return 1
    return quantities[index] ?? line.quantity
  }

  /** The draft line this row resolves to, or null when a decision is still pending. */
  function resolve(line: VoiceLine, index: number): VoiceConfirmedLine | null {
    switch (line.kind) {
      case 'product':
        return { kind: 'product', productId: line.productId, name: line.name, variant: line.variant, quantity: quantityOf(line, index), notes: line.notes }
      case 'pizza':
        return { kind: 'pizza', pizza: line.pizza, name: line.name, quantity: quantityOf(line, index), notes: line.notes }
      case 'pickProduct': {
        const option = line.options.find((candidate) => candidate.productId === choices[index])
        if (!option) return null
        // A picked product with variants needs one of them, like missingVariant: the server
        // rejects a line without its variant (S8).
        const variants = variantOptionsFor(line, choices, products, index)
        if (variants.length > 0) {
          const variant = variantChoices[index]
          if (variant === undefined || !variants.includes(variant)) return null
          return { kind: 'product', productId: option.productId, name: option.name, variant, quantity: quantityOf(line, index), notes: line.notes }
        }
        return { kind: 'product', productId: option.productId, name: option.name, variant: null, quantity: quantityOf(line, index), notes: line.notes }
      }
      case 'missingVariant': {
        const variant = choices[index]
        if (variant === undefined) return null
        return { kind: 'product', productId: line.productId, name: line.name, variant, quantity: quantityOf(line, index), notes: line.notes }
      }
      case 'unknown':
        return null
    }
  }

  function interpret() {
    setLines(parseSpokenOrder(text, { products, pizzaCatalog }))
    setQuantities({})
    setChoices({})
    setVariantChoices({})
  }

  function confirm() {
    if (lines === null) return
    const complete = lines
      .map((line, index) => resolve(line, index))
      .filter((line): line is VoiceConfirmedLine => line !== null)
    if (complete.length === 0) return
    onAdd(complete)
  }

  const resolved = lines === null ? [] : lines.map((line, index) => resolve(line, index))
  const addableCount = resolved.filter((line) => line !== null).length
  const pendingCount = resolved.length - addableCount

  return (
    <Modal title="Pedido por voz" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Textarea
          id={fieldId}
          label="Dicta o escribe el pedido"
          placeholder="Ej. dos cocas y una grande de pepperoni"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="button" className="min-h-12" onClick={interpret}>
          Interpretar
        </Button>

        {lines === null && <p className="text-sm text-slate-600">{EMPTY_HINT}</p>}
        {lines !== null && lines.length === 0 && <p className="text-sm text-slate-600">No se reconoció ninguna línea.</p>}

        {lines !== null && lines.length > 0 && (
          <>
            <ul className="flex flex-col gap-3">
              {lines.map((line, index) => (
                <li
                  key={index}
                  className={cn(
                    'rounded-xl border p-3',
                    line.kind === 'unknown'
                      ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40'
                      : 'border-slate-200',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'break-words font-semibold',
                          line.kind === 'unknown' ? 'text-amber-900 dark:text-amber-200' : 'text-slate-900',
                        )}
                      >
                        {rowName(line, choices, index)}
                      </p>
                      {line.kind !== 'unknown' && line.notes.trim() !== '' && (
                        <p className="text-sm text-slate-600">Nota: {line.notes}</p>
                      )}
                      {line.kind === 'pickProduct' && (
                        <div role="group" aria-label={`Elige: ${line.heard}`} className="mt-2 flex flex-wrap gap-2">
                          {line.options.map((option) => (
                            <button
                              key={option.productId}
                              type="button"
                              aria-pressed={choices[index] === option.productId}
                              onClick={() => {
                                setChoices((current) => ({ ...current, [index]: option.productId }))
                                // The variant belongs to one product: picking another clears it.
                                setVariantChoices((current) => {
                                  if (current[index] === undefined) return current
                                  const next = { ...current }
                                  delete next[index]
                                  return next
                                })
                              }}
                              className={chipClasses(choices[index] === option.productId)}
                            >
                              {option.name}
                            </button>
                          ))}
                        </div>
                      )}
                      {line.kind === 'pickProduct' && variantOptionsFor(line, choices, products, index).length > 0 && (
                        <div role="group" aria-label={`Elige: ${rowName(line, choices, index)}`} className="mt-2 flex flex-wrap gap-2">
                          {variantOptionsFor(line, choices, products, index).map((option) => (
                            <button
                              key={option}
                              type="button"
                              aria-pressed={variantChoices[index] === option}
                              onClick={() => setVariantChoices((current) => ({ ...current, [index]: option }))}
                              className={chipClasses(variantChoices[index] === option)}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      )}
                      {line.kind === 'missingVariant' && (
                        <div role="group" aria-label={`Elige: ${line.name}`} className="mt-2 flex flex-wrap gap-2">
                          {line.options.map((option) => (
                            <button
                              key={option}
                              type="button"
                              aria-pressed={choices[index] === option}
                              onClick={() => setChoices((current) => ({ ...current, [index]: option }))}
                              className={chipClasses(choices[index] === option)}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      )}
                      {line.kind === 'unknown' && (
                        <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{line.reason}</p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">Escuchaste: {line.heard}</p>
                    </div>
                    {line.kind !== 'unknown' && (
                      <div
                        role="group"
                        aria-label={`Cantidad de ${rowName(line, choices, index)}`}
                        className="flex flex-none items-center gap-0.5 rounded-lg bg-slate-100 p-0.5"
                      >
                        <button
                          type="button"
                          aria-label="Quitar uno"
                          disabled={quantityOf(line, index) <= 1}
                          onClick={() => setQuantities((current) => ({ ...current, [index]: quantityOf(line, index) - 1 }))}
                          className="h-12 w-12 rounded-lg border border-slate-300 bg-white text-2xl font-bold text-red-700 disabled:opacity-40"
                        >
                          −
                        </button>
                        <output aria-live="polite" className="min-w-10 text-center text-xl font-extrabold text-slate-900">
                          {`×${quantityOf(line, index)}`}
                        </output>
                        <button
                          type="button"
                          aria-label="Agregar uno"
                          onClick={() => setQuantities((current) => ({ ...current, [index]: quantityOf(line, index) + 1 }))}
                          className="h-12 w-12 rounded-lg border border-slate-300 bg-white text-2xl font-bold text-red-700"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {pendingCount > 0 && (
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                {pendingCount === 1 ? '1 línea no se va a agregar' : `${pendingCount} líneas no se van a agregar`}
              </p>
            )}
          </>
        )}

        <div className="flex gap-2">
          <Button type="button" disabled={addableCount === 0} onClick={confirm} className="min-h-12 flex-1">
            Agregar al pedido
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} className="min-h-12 flex-1">
            Cancelar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
