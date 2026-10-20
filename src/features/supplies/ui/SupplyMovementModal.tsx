import { useState, type FormEvent } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { toUserMessage } from '../../../shared/errors'
import { parseMoneyInput } from '../../../shared/money'
import { parseQuantityInput, SUPPLY_UNIT_LABELS, type Supply } from '../domain/supply'
import { formatQuantity } from './formatQuantity'

const MAX_QUANTITY = 999999999.999
const MAX_COST_CENTS = 2000000000
const QUANTITY_HINT = 'Usa punto o coma para decimales, sin separador de miles.'

interface SupplyMovementModalProps {
  mode: 'purchase' | 'count'
  supply: Supply
  onPurchase: (quantity: number, costCents: number) => Promise<void>
  onCount: (counted: number) => Promise<void>
  onClose: () => void
}

export function SupplyMovementModal({ mode, supply, onPurchase, onCount, onClose }: SupplyMovementModalProps) {
  const unitLabel = SUPPLY_UNIT_LABELS[supply.unit]
  const [quantityInput, setQuantityInput] = useState(mode === 'count' ? formatQuantity(supply.stock) : '')
  const [costInput, setCostInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const quantity = parseQuantityInput(quantityInput)

    let save: () => Promise<void>
    if (mode === 'purchase') {
      if (quantity === null || quantity <= 0) {
        setError('La cantidad debe ser mayor a cero.')
        return
      }
      if (quantity > MAX_QUANTITY) {
        setError('La cantidad es demasiado grande.')
        return
      }
      const costCents = parseMoneyInput(costInput)
      if (costCents === null) {
        setError('El monto pagado no es válido.')
        return
      }
      if (costCents > MAX_COST_CENTS) {
        setError('El monto pagado es demasiado grande.')
        return
      }
      save = () => onPurchase(quantity, costCents)
    } else {
      if (quantity === null) {
        setError('El conteo no puede ser negativo.')
        return
      }
      if (quantity > MAX_QUANTITY) {
        setError('La cantidad es demasiado grande.')
        return
      }
      save = () => onCount(quantity)
    }

    setError(null)
    setIsSubmitting(true)
    try {
      await save()
      onClose()
    } catch (submitError) {
      setError(toUserMessage(submitError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal title={`${mode === 'purchase' ? 'Compra de' : 'Conteo de'} ${supply.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <div className="flex flex-col gap-1">
          <Input
            id="supply-movement-quantity"
            label={mode === 'purchase' ? `Cantidad recibida (${unitLabel})` : `Existencias contadas (${unitLabel})`}
            inputMode="decimal"
            value={quantityInput}
            onChange={(e) => setQuantityInput(e.target.value)}
          />
          <p className="text-xs text-slate-500">{QUANTITY_HINT}</p>
        </div>
        {mode === 'purchase' && (
          <Input
            id="supply-movement-cost"
            label="Monto pagado (MXN)"
            inputMode="decimal"
            placeholder="450.00"
            value={costInput}
            onChange={(e) => setCostInput(e.target.value)}
          />
        )}
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
