import { useState, type FormEvent } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { toUserMessage } from '../../../shared/errors'
import {
  parseQuantityInput,
  supplyFormSchema,
  SUPPLY_UNITS,
  SUPPLY_UNIT_LABELS,
  type Supply,
  type SupplyFormValues,
  type SupplyUnit,
} from '../domain/supply'
import { formatQuantity } from './formatQuantity'

interface SupplyFormModalProps {
  initial?: Supply
  onSubmit: (values: SupplyFormValues) => Promise<void>
  onClose: () => void
}

export function SupplyFormModal({ initial, onSubmit, onClose }: SupplyFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [unit, setUnit] = useState<SupplyUnit>(initial?.unit ?? 'kg')
  const [stockMinInput, setStockMinInput] = useState(initial ? formatQuantity(initial.stockMin) : '')
  const [active, setActive] = useState(initial?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const stockMinText = stockMinInput.trim()
    // Empty means 0; anything unparseable (null) is rejected by the schema.
    const stockMin = stockMinText === '' ? 0 : parseQuantityInput(stockMinText)

    const parsed = supplyFormSchema.safeParse({ name, unit, stockMin, active })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos.')
      return
    }

    setError(null)
    setIsSubmitting(true)
    try {
      await onSubmit(parsed.data)
      onClose()
    } catch (submitError) {
      setError(toUserMessage(submitError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal title={initial ? 'Editar insumo' : 'Nuevo insumo'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input id="supply-name" label="Nombre" value={name} onChange={(e) => setName(e.target.value)} />

        <div className="flex flex-col gap-1">
          <label htmlFor="supply-unit" className="text-sm font-medium text-slate-700">
            Unidad
          </label>
          <select
            id="supply-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value as SupplyUnit)}
            className="rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900 focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-200"
          >
            {SUPPLY_UNITS.map((option) => (
              <option key={option} value={option}>
                {SUPPLY_UNIT_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Input
            id="supply-stock-min"
            label="Mínimo"
            inputMode="decimal"
            placeholder="0"
            value={stockMinInput}
            onChange={(e) => setStockMinInput(e.target.value)}
          />
          <p className="text-xs text-slate-500">
            Con esta cantidad o menos, el insumo aparece en Para comprar. Las existencias se cargan con Compra y Conteo.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-red-700 focus:ring-red-500"
          />
          Insumo activo
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
