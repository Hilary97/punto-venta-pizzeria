import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Textarea } from '../../../shared/ui/Textarea'
import { cn } from '../../../shared/ui/cn'
import { pizzaLabelLayout } from '../../pizza/domain/pizza'
import { NoteShortcutChips } from '../../pizza/ui/NoteShortcutChips'
import { PizzaLabelGroups } from '../../pizza/ui/PizzaLabelGroups'
import {
  customerNameLabel,
  MAX_CUSTOMER_NAME_LENGTH,
  MAX_ITEM_NOTES_LENGTH,
  MAX_ORDER_NOTES_LENGTH,
  MISSING_LABEL,
  productLineLabel,
  tableLabel,
  type MissingPiece,
  type Order,
  type OrderService,
} from '../domain/order'
import type { DraftLine } from '../domain/orderDraft'
import { AddingToOrderBar } from './AddingToOrderBar'
import { OrderContextBar } from './OrderContextBar'
import { ServiceSelector } from './ServiceSelector'
import { StepBar } from './StepBar'

/** How long the "Quitaste … · Deshacer" snackbar stays. */
export const UNDO_WINDOW_MS = 8000

interface ReviewStepProps {
  contextLabel: string
  /** The open order receiving the products; `null` for a new order. */
  addingTo: Order | null
  onChangeContext: () => void
  onCancelEdit: () => void
  draft: DraftLine[]
  onIncrement: (lineId: string) => void
  onDecrement: (lineId: string) => void
  onRemove: (lineId: string) => void
  onRestore: (line: DraftLine, index: number) => void
  onLineNotes: (lineId: string, notes: string) => void
  orderNotes: string
  onOrderNotes: (notes: string) => void
  /** Admin-managed order note shortcuts, as chips under the order note. */
  noteShortcuts?: string[]
  /** Shortcuts of the product's category, as chips under a product line's note. Pizza lines have their own. */
  productNoteShortcuts?: (productId: string) => string[]
  /** Admin-managed pizza note shortcuts, as chips under a pizza line's note. */
  pizzaNoteShortcuts?: string[]
  pickupTime: string
  onPickupTime: (time: string) => void
  missing: MissingPiece[]
  /** Service, table and name, completed here when step 1 was skipped. */
  identity: ReviewIdentity
  error: string | null
  isSubmitting: boolean
  onSubmit: (event: FormEvent) => void
  aboveBottomNav: boolean
}

export interface ReviewIdentity {
  service: OrderService | null
  onService: (service: OrderService | null) => void
  tableNumber: number | null
  onTable: (tableNumber: number | null) => void
  customerName: string
  onCustomerName: (name: string) => void
  /** Tables without an open order, the only ones a new order can take. */
  freeTables: number[]
}

function lineLabel(line: DraftLine): string {
  return line.kind === 'product' ? productLineLabel(line.name, line.variant) : line.name
}

export function ReviewStep({
  contextLabel,
  addingTo,
  onChangeContext,
  onCancelEdit,
  draft,
  onIncrement,
  onDecrement,
  onRemove,
  onRestore,
  onLineNotes,
  orderNotes,
  onOrderNotes,
  noteShortcuts = [],
  productNoteShortcuts,
  pizzaNoteShortcuts = [],
  pickupTime,
  onPickupTime,
  missing,
  identity,
  error,
  isSubmitting,
  onSubmit,
  aboveBottomNav,
}: ReviewStepProps) {
  const pickupId = useId()
  const completeId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [removed, setRemoved] = useState<{ line: DraftLine; index: number } | null>(null)

  useEffect(() => {
    if (removed === null) return
    const timer = setTimeout(() => setRemoved(null), UNDO_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [removed])

  function handleRemove(line: DraftLine) {
    setRemoved({ line, index: draft.indexOf(line) })
    if (editingNoteId === line.lineId) setEditingNoteId(null)
    onRemove(line.lineId)
    // The pressed button leaves the page: keep keyboard focus inside the step.
    headingRef.current?.focus()
  }

  function handleUndo() {
    if (removed) onRestore(removed.line, removed.index)
    setRemoved(null)
  }

  const itemsOk = !missing.includes('products')
  const identityOk = !missing.some((piece) => piece !== 'products')
  // Decided on arrival so the fields stay put while the waiter types the name.
  const [showIdentity] = useState(() => !addingTo && !identityOk)

  return (
    <form onSubmit={onSubmit} className={cn('flex min-w-0 flex-col gap-4', removed && 'pb-16')}>
      <h2 ref={headingRef} tabIndex={-1} data-step-heading className="text-lg font-bold text-slate-900 focus:outline-none">
        Revisar pedido
      </h2>
      {addingTo ? (
        <AddingToOrderBar order={addingTo} disabled={isSubmitting} onCancel={onCancelEdit} />
      ) : (
        <OrderContextBar variant="summary" label={contextLabel} onChange={onChangeContext} disabled={isSubmitting} />
      )}

      {draft.length > 0 && (
        <ul className="flex flex-col gap-2">
          {draft.map((line) => {
            const label = lineLabel(line)
            const { title, groups } = pizzaLabelLayout(label)
            const hasNote = line.notes.trim() !== ''
            const isEditing = editingNoteId === line.lineId
            const lineShortcuts =
              line.kind === 'product' ? (productNoteShortcuts?.(line.productId) ?? []) : pizzaNoteShortcuts
            return (
              <li key={line.lineId} className="rounded-xl border border-slate-200 bg-white p-2.5">
                <div className="min-w-0 break-words">
                  <p className="text-sm font-bold leading-snug text-slate-900">{title}</p>
                  <PizzaLabelGroups groups={groups} />
                  {hasNote && !isEditing && <p className="mt-0.5 text-[13px] text-slate-600">Nota: {line.notes.trim()}</p>}
                </div>
                {isEditing && (
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      aria-label={`Nota para ${label}`}
                      placeholder="Nota (opcional)"
                      value={line.notes}
                      maxLength={MAX_ITEM_NOTES_LENGTH}
                      disabled={isSubmitting}
                      autoFocus
                      className="min-h-12 w-full"
                      onChange={(e) => onLineNotes(line.lineId, e.target.value)}
                      onKeyDown={(e) => {
                        // Enter closes the note instead of sending the whole order.
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        setEditingNoteId(null)
                      }}
                    />
                    <Button type="button" variant="secondary" className="min-h-12 shrink-0" onClick={() => setEditingNoteId(null)}>
                      Listo
                    </Button>
                  </div>
                )}
                {isEditing && !isSubmitting && lineShortcuts.length > 0 && (
                  <div className="mt-1.5">
                    <NoteShortcutChips
                      label={`nota de ${label}`}
                      shortcuts={lineShortcuts}
                      note={line.notes}
                      maxLength={MAX_ITEM_NOTES_LENGTH}
                      onChange={(notes) => onLineNotes(line.lineId, notes)}
                    />
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <div role="group" aria-label={`Cantidad de ${label}`} className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
                    <button
                      type="button"
                      aria-label="Quitar uno"
                      disabled={isSubmitting || line.quantity <= 1}
                      onClick={() => onDecrement(line.lineId)}
                      className="h-12 w-12 rounded-lg border border-slate-300 bg-white text-2xl font-bold text-red-700 disabled:opacity-40 dark:text-red-300"
                    >
                      −
                    </button>
                    <span aria-live="polite" className="min-w-8 text-center text-xl font-extrabold text-slate-900">
                      {line.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label="Agregar uno"
                      disabled={isSubmitting}
                      onClick={() => onIncrement(line.lineId)}
                      className="h-12 w-12 rounded-lg border border-slate-300 bg-white text-2xl font-bold text-red-700 disabled:opacity-40 dark:text-red-300"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label={`${hasNote ? 'Editar nota' : 'Agregar nota'} a ${label}`}
                    disabled={isSubmitting}
                    onClick={() => setEditingNoteId(isEditing ? null : line.lineId)}
                    className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-red-700 disabled:opacity-50 dark:text-red-300"
                  >
                    {hasNote ? 'Editar nota' : 'Nota'}
                  </button>
                  <button
                    type="button"
                    aria-label={`Quitar ${label} del pedido`}
                    disabled={isSubmitting}
                    onClick={() => handleRemove(line)}
                    className="ml-auto min-h-11 rounded-lg border border-rose-300 bg-rose-50 px-3 text-sm font-bold text-rose-800 disabled:opacity-50 dark:border-rose-700 dark:bg-rose-950/60 dark:text-rose-200"
                  >
                    Quitar
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {showIdentity && (
        <section
          aria-labelledby={`${completeId}-title`}
          className="flex flex-col gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/60"
        >
          <h3 id={`${completeId}-title`} className="text-base font-bold text-slate-900">
            Completar pedido
          </h3>
          <ServiceSelector selected={identity.service} onSelect={identity.onService} disabled={isSubmitting} />
          {identity.service !== 'takeaway' && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${completeId}-table`} className="text-sm font-medium text-slate-700">
                Mesa
              </label>
              <select
                id={`${completeId}-table`}
                value={identity.tableNumber ?? ''}
                disabled={isSubmitting}
                onChange={(e) => identity.onTable(e.target.value === '' ? null : Number(e.target.value))}
                className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900"
              >
                <option value="">Sin mesa</option>
                {identity.freeTables.map((n) => (
                  <option key={n} value={n}>
                    {tableLabel(n)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Input
            id={`${completeId}-name`}
            label={customerNameLabel(identity.service)}
            value={identity.customerName}
            maxLength={MAX_CUSTOMER_NAME_LENGTH}
            disabled={isSubmitting}
            autoComplete="off"
            onChange={(e) => identity.onCustomerName(e.target.value)}
          />
        </section>
      )}

      {!addingTo && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Nota del pedido (opcional)
              <Textarea
                value={orderNotes}
                maxLength={MAX_ORDER_NOTES_LENGTH}
                disabled={isSubmitting}
                onChange={(e) => onOrderNotes(e.target.value)}
              />
            </label>
            {!isSubmitting && (
              <NoteShortcutChips
                label="nota del pedido"
                shortcuts={noteShortcuts}
                note={orderNotes}
                maxLength={MAX_ORDER_NOTES_LENGTH}
                onChange={onOrderNotes}
              />
            )}
          </div>
          <Input
            id={pickupId}
            type="time"
            label="Hora para recoger (opcional)"
            value={pickupTime}
            disabled={isSubmitting}
            onChange={(e) => onPickupTime(e.target.value)}
          />
        </>
      )}

      <ul aria-label="Lista de verificación" className="flex flex-col gap-1 rounded-xl bg-slate-100 p-3 text-sm">
        {!addingTo && identityOk && <CheckRow ok>Mesa y tipo de pedido</CheckRow>}
        {itemsOk && <CheckRow ok>Productos agregados</CheckRow>}
        {missing.map((piece) => (
          <CheckRow key={piece}>{`Falta: ${MISSING_LABEL[piece]}`}</CheckRow>
        ))}
      </ul>

      {error && <ErrorBanner message={error} />}

      {addingTo && (
        <Button type="button" variant="secondary" className="min-h-12" disabled={isSubmitting} onClick={onCancelEdit}>
          Cancelar edición
        </Button>
      )}

      {removed && (
        <div
          role="status"
          className={cn(
            'fixed inset-x-3 z-30 mx-auto flex min-h-12 max-w-2xl items-center justify-between gap-2 rounded-xl bg-slate-900 py-1 pl-3.5 pr-1.5 text-sm text-white shadow-lg dark:bg-slate-200 dark:text-slate-900',
            aboveBottomNav
              ? 'bottom-[calc(68px+5.5rem+env(safe-area-inset-bottom))] sm:bottom-[calc(5.5rem+env(safe-area-inset-bottom))]'
              : 'bottom-[calc(5.5rem+env(safe-area-inset-bottom))]',
          )}
        >
          <span className="min-w-0 break-words">{`Quitaste ${lineLabel(removed.line)}`}</span>
          <button type="button" onClick={handleUndo} className="min-h-11 shrink-0 rounded-lg bg-white px-4 font-extrabold text-slate-900">
            Deshacer
          </button>
        </div>
      )}

      <StepBar aboveBottomNav={aboveBottomNav}>
        <Button type="submit" size="lg" className="min-h-[52px] w-full disabled:bg-slate-300 disabled:text-slate-700 disabled:opacity-100" disabled={missing.length > 0 || isSubmitting}>
          {isSubmitting ? 'Procesando…' : addingTo ? 'Agregar al pedido' : 'Enviar a cocina'}
        </Button>
      </StepBar>
    </form>
  )
}

function CheckRow({ ok = false, children }: { ok?: boolean; children: string }) {
  return (
    <li className={cn('flex gap-2', ok ? 'text-slate-800' : 'font-bold text-amber-800 dark:text-amber-300')}>
      <span aria-hidden="true" className={ok ? 'text-emerald-700 dark:text-emerald-400' : undefined}>
        {ok ? '✓' : '!'}
      </span>
      <span>{children}</span>
    </li>
  )
}
