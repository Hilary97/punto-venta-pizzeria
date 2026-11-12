import { useId } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Input } from '../../../shared/ui/Input'
import { cn } from '../../../shared/ui/cn'
import {
  MAX_CUSTOMER_NAME_LENGTH,
  TABLE_NUMBERS,
  tableLabel,
  type Order,
  type OrderService,
} from '../domain/order'
import type { TableOccupancy } from '../domain/tableOccupancy'
import { ServiceSelector } from './ServiceSelector'
import { StepBar } from './StepBar'

interface MesaStepProps {
  service: OrderService | null
  onService: (service: OrderService | null) => void
  tableNumber: number | null
  onTable: (tableNumber: number | null) => void
  customerName: string
  onCustomerName: (name: string) => void
  occupancy: Map<number, TableOccupancy>
  openOrdersCount: number
  onOpenOrders: () => void
  onAddToOrder: (order: Order) => void
  /** First thing still missing, already worded (e.g. `nombre del cliente`); `null` when the step is valid. */
  missing: string | null
  onNext: () => void
  aboveBottomNav: boolean
  disabled?: boolean
}

export function MesaStep({
  service,
  onService,
  tableNumber,
  onTable,
  customerName,
  onCustomerName,
  occupancy,
  openOrdersCount,
  onOpenOrders,
  onAddToOrder,
  missing,
  onNext,
  aboveBottomNav,
  disabled = false,
}: MesaStepProps) {
  const nameId = useId()
  const hintId = useId()
  const isTakeaway = service === 'takeaway'
  const selected = tableNumber === null ? undefined : occupancy.get(tableNumber)
  const blocked = missing !== null || selected !== undefined
  const nameLabel = isTakeaway
    ? 'Nombre del cliente (obligatorio para llevar)'
    : 'Nombre del cliente (opcional en mesa · obligatorio para llevar)'

  return (
    <section aria-labelledby={`${nameId}-where`} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col items-start gap-2">
        <h2 id={`${nameId}-where`} tabIndex={-1} data-step-heading className="text-lg font-bold leading-tight text-slate-900 focus:outline-none">
          ¿Dónde es el pedido?
        </h2>
        <button
          type="button"
          disabled={disabled}
          onClick={onOpenOrders}
          className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
        >
          Pedidos abiertos
          <span className="grid min-w-6 place-items-center rounded-full bg-red-700 px-1.5 text-xs font-bold text-white">
            {openOrdersCount}
          </span>
        </button>
      </div>

      <ServiceSelector selected={service} onSelect={onService} disabled={disabled} />

      {!isTakeaway && (
        <>
          <h2 className="text-lg font-bold text-slate-900">Elige la mesa</h2>
          <div role="group" aria-label="Mesa" className="grid auto-rows-fr grid-cols-3 gap-2">
            {TABLE_NUMBERS.map((n) => {
              const info = occupancy.get(n)
              const isSelected = n === tableNumber
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={disabled}
                  onClick={() => onTable(isSelected ? null : n)}
                  className={cn(
                    'relative flex min-h-[104px] min-w-0 flex-col justify-center gap-0.5 rounded-xl border-2 p-2 text-left transition-colors disabled:opacity-50',
                    info
                      ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/60'
                      : 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/60',
                    isSelected && 'border-red-700 ring-2 ring-red-700 ring-offset-1 ring-offset-slate-50 dark:border-red-400 dark:ring-red-400',
                  )}
                >
                  {isSelected && (
                    <span
                      aria-hidden="true"
                      className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-red-700 text-xs font-extrabold text-white"
                    >
                      ✓
                    </span>
                  )}
                  <strong className="text-lg leading-tight text-slate-900">{tableLabel(n)}</strong>{' '}
                  <em className={cn('text-xs font-bold not-italic', info ? 'text-amber-800 dark:text-amber-200' : 'text-emerald-700 dark:text-emerald-300')}>
                    {info ? 'Ocupada' : 'Libre'}
                  </em>
                  {info && (
                    <>
                      <OccupiedDetail info={info} />
                    </>
                  )}
                </button>
              )
            })}
          </div>
          <div aria-live="polite" className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800">
            {tableNumber === null ? (
              <p>Toca una mesa libre, o escribe el nombre del cliente.</p>
            ) : selected ? (
              <>
                <p>{`${tableLabel(tableNumber)} ocupada · ${selected.detail}`}</p>
                <p className="text-slate-600">Esta mesa ya tiene un pedido abierto.</p>
                <Button
                  variant="secondary"
                  disabled={disabled}
                  className="mt-2 min-h-12 w-full border-2 border-red-700 bg-white text-red-700 hover:bg-red-50 dark:border-red-400 dark:text-red-300 dark:hover:bg-red-950"
                  onClick={() => onAddToOrder(selected.order)}
                >
                  Agregar a este pedido
                </Button>
              </>
            ) : (
              <p>{`${tableLabel(tableNumber)} está libre. Se abrirá un pedido nuevo.`}</p>
            )}
          </div>
        </>
      )}

      <Input
        id={nameId}
        label={nameLabel}
        value={customerName}
        maxLength={MAX_CUSTOMER_NAME_LENGTH}
        disabled={disabled}
        autoComplete="off"
        onChange={(event) => onCustomerName(event.target.value)}
      />

      <StepBar aboveBottomNav={aboveBottomNav}>
        {missing !== null && (
          <p id={hintId} className="text-sm font-medium text-amber-800 dark:text-amber-300">
            {`Falta: ${missing}`}
          </p>
        )}
        <Button
          size="lg"
          className="min-h-[52px] w-full disabled:bg-slate-300 disabled:text-slate-700 disabled:opacity-100"
          disabled={blocked || disabled}
          aria-describedby={missing !== null ? hintId : undefined}
          onClick={onNext}
        >
          Siguiente: productos →
        </Button>
      </StepBar>
    </section>
  )
}

/**
 * Detail lines of an occupied tile: `Ficha 7 · 25 min` on one line, the waiter below, and the
 * schedule (instead of the "Sin ficha" line, which says nothing for a scheduled order).
 */
function OccupiedDetail({ info }: { info: TableOccupancy }) {
  const waiter = info.order.waiterName
  const waiterSuffix = waiter ? ` · ${waiter}` : ''
  const main = waiter && info.detail.endsWith(waiterSuffix) ? info.detail.slice(0, -waiterSuffix.length) : info.detail
  const scheduled = info.statusKind === 'scheduled'
  const showMain = !(scheduled && info.order.token == null)
  return (
    <>
      {scheduled && <small className="block text-xs font-bold leading-tight text-slate-800">{info.statusLabel}</small>}
      {showMain && (
        <small className="block text-xs leading-tight text-slate-700">
          {main.split(' · ').map((part, index) => (
            <span key={part}>
              {index > 0 && ' · '}
              <span className="whitespace-nowrap">{part}</span>
            </span>
          ))}
        </small>
      )}
      {waiter && (
        <small className="block min-w-0 break-words text-xs leading-tight text-slate-700">
          <span className="sr-only"> · </span>
          {waiter}
        </small>
      )}
      {info.statusKind === 'delivered' && <small className="block text-xs font-bold leading-tight text-slate-800">{info.statusLabel}</small>}
    </>
  )
}
