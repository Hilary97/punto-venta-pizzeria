import { useState, type FormEvent } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Modal } from '../../../shared/ui/Modal'
import { toUserMessage } from '../../../shared/errors'
import { PIN_LENGTH, isValidPin } from '../domain/waiter'
import { PinInput } from './PinInput'

interface WaiterPinModalProps {
  waiterName: string
  onSubmit: (pin: string) => Promise<void>
  onClose: () => void
}

export function WaiterPinModal({ waiterName, onSubmit, onClose }: WaiterPinModalProps) {
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    if (!isValidPin(pin)) {
      setError(`El PIN debe tener exactamente ${PIN_LENGTH} dígitos.`)
      return
    }
    if (pin !== confirmPin) {
      setError('Los PIN no coinciden.')
      return
    }

    setError(null)
    setIsSubmitting(true)
    try {
      await onSubmit(pin)
      onClose()
    } catch (submitError) {
      setError(toUserMessage(submitError))
      setIsSubmitting(false)
    }
  }

  return (
    <Modal title={`Cambiar PIN de ${waiterName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <PinInput id="new-waiter-pin" label="Nuevo PIN" value={pin} onChange={setPin} />
        <PinInput id="new-waiter-pin-confirm" label="Confirmar PIN" value={confirmPin} onChange={setConfirmPin} />
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
