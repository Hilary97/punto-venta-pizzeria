import { useState, type FormEvent } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { toUserMessage } from '../../../shared/errors'

export type StockAdjustMode = 'receive' | 'count'

interface StockAdjustModalProps {
  mode: StockAdjustMode
  productName: string
  currentStock: number
  onSubmit: (value: number) => Promise<void>
  onClose: () => void
}

const COPY = {
  receive: { title: 'Entrada de', label: 'Cantidad recibida', invalid: 'La cantidad debe ser mayor a cero.', min: 1 },
  count: { title: 'Conteo de', label: 'Existencias contadas', invalid: 'El conteo no puede ser negativo.', min: 0 },
} as const

export function StockAdjustModal({ mode, productName, currentStock, onSubmit, onClose }: StockAdjustModalProps) {
  const copy = COPY[mode]
  const [input, setInput] = useState(mode === 'count' ? String(currentStock) : '')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = input.trim()
    const value = Number(text)
    if (!/^-?\d+$/.test(text) || value < copy.min) {
      setError(copy.invalid)
      return
    }

    setError(null)
    setIsSubmitting(true)
    try {
      await onSubmit(value)
      onClose()
    } catch (submitError) {
      setError(toUserMessage(submitError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal title={`${copy.title} ${productName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input
          id="stock-adjust-value"
          label={copy.label}
          inputMode="numeric"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
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
