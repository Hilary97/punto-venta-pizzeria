import { useMemo, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { MoneyText } from '../../../shared/ui/MoneyText'
import type { SaleWithItems } from '../../sales/domain/sale'
import { calculateReturnableQuantity } from '../domain/returnable'

interface ReturnItemsFormProps {
  sale: SaleWithItems
  onConfirm: (selection: { saleItemId: string; quantity: number }[], reason: string) => Promise<void>
  onCancel: () => void
}

export function ReturnItemsForm({ sale, onConfirm, onCancel }: ReturnItemsFormProps) {
  const returnableItems = useMemo(
    () =>
      sale.items.map((item) => ({
        ...item,
        returnable: calculateReturnableQuantity(item.quantity, item.returnedQuantity),
      })),
    [sale],
  )

  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const selection = Object.entries(quantities).filter(([, quantity]) => quantity > 0)
  const refundCents = returnableItems
    .filter((item) => (quantities[item.id] ?? 0) > 0)
    .reduce((sum, item) => sum + item.unitPriceCents * (quantities[item.id] ?? 0), 0)

  function setQuantity(saleItemId: string, quantity: number) {
    setQuantities((current) => ({ ...current, [saleItemId]: quantity }))
  }

  async function handleConfirm() {
    if (selection.length === 0) {
      setError('Selecciona al menos un artículo a devolver.')
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      await onConfirm(
        selection.map(([saleItemId, quantity]) => ({ saleItemId, quantity })),
        reason,
      )
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'No se pudo registrar la devolución.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} />}

      <ul className="divide-y divide-slate-200">
        {returnableItems.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-slate-900">{item.productName}</p>
              <p className="text-sm text-slate-500">
                Vendido: {item.quantity} · Disponible para devolver: {item.returnable}
              </p>
            </div>
            <input
              type="number"
              min={0}
              max={item.returnable}
              value={quantities[item.id] ?? 0}
              disabled={item.returnable === 0}
              onChange={(e) => {
                const value = Math.max(0, Math.min(item.returnable, Number(e.target.value) || 0))
                setQuantity(item.id, value)
              }}
              aria-label={`Cantidad a devolver de ${item.productName}`}
              className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-center focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:bg-slate-100"
            />
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1">
        <label htmlFor="return-reason" className="text-sm font-medium text-slate-700">
          Motivo (opcional)
        </label>
        <textarea
          id="return-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-200"
        />
      </div>

      <div className="flex items-center justify-between rounded-xl bg-slate-100 p-4">
        <span className="font-medium text-slate-600">Efectivo a devolver</span>
        <MoneyText cents={refundCents} className="text-xl font-bold text-red-700" />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="button" onClick={handleConfirm} disabled={isSubmitting || selection.length === 0}>
          {isSubmitting ? 'Procesando…' : 'Confirmar devolución'}
        </Button>
      </div>
    </div>
  )
}
