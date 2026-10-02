import { useState, type FormEvent } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { toUserMessage } from '../../../shared/errors'
import {
  MAX_WAITER_NAME_LENGTH,
  PIN_LENGTH,
  isValidPin,
  isValidWaiterName,
  normalizeWaiterName,
} from '../domain/waiter'
import { PinInput } from './PinInput'

interface WaiterFormModalProps {
  /** Present when renaming; absent when creating (which also asks for a PIN). */
  initialName?: string
  onSubmit: (name: string, pin: string) => Promise<void>
  onClose: () => void
}

export function WaiterFormModal({ initialName, onSubmit, onClose }: WaiterFormModalProps) {
  const isEditing = initialName !== undefined
  const [name, setName] = useState(initialName ?? '')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    if (!isValidWaiterName(name)) {
      setError(`El nombre debe tener entre 1 y ${MAX_WAITER_NAME_LENGTH} caracteres.`)
      return
    }
    if (!isEditing) {
      if (!isValidPin(pin)) {
        setError(`El PIN debe tener exactamente ${PIN_LENGTH} dígitos.`)
        return
      }
      if (pin !== confirmPin) {
        setError('Los PIN no coinciden.')
        return
      }
    }

    setError(null)
    setIsSubmitting(true)
    try {
      await onSubmit(normalizeWaiterName(name), pin)
      onClose()
    } catch (submitError) {
      setError(toUserMessage(submitError))
      setIsSubmitting(false)
    }
  }

  return (
    <Modal title={isEditing ? 'Editar mesero' : 'Nuevo mesero'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input id="waiter-name" label="Nombre" value={name} onChange={(e) => setName(e.target.value)} required />
        {!isEditing && (
          <>
            <PinInput id="waiter-pin" label="PIN" value={pin} onChange={setPin} />
            <PinInput id="waiter-pin-confirm" label="Confirmar PIN" value={confirmPin} onChange={setConfirmPin} />
          </>
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
