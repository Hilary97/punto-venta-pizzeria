import { useState, type FormEvent } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { toUserMessage } from '../../../shared/errors'
import { parseMoneyInput } from '../../../shared/money'
import { parseQuantityInput, SUPPLY_UNIT_LABELS, type Supply } from '../domain/supply'
import { formatQuantity } from './formatQuantity'

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
      const costCents = parseMoneyInput(costInput)
      if (costCents === null) {
        setError('El monto pagado no es válido.')
        return
      }
      save = () => onPurchase(quantity, costCents)
    } else {
      if (quantity === null) {
        setError('El conteo no puede ser negativo.')
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
        <Input
          id="supply-movement-quantity"
          label={mode === 'purchase' ? `Cantidad recibida (${unitLabel})` : `Existencias contadas (${unitLabel})`}
          inputMode="decimal"
          value={quantityInput}
          onChange={(e) => setQuantityInput(e.target.value)}
        />
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
