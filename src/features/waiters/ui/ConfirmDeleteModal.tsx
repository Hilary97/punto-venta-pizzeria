import { useRef, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Modal } from '../../../shared/ui/Modal'
import { toUserMessage } from '../../../shared/errors'

interface ConfirmDeleteModalProps {
  title: string
  message: string
  /** Performs the deletion; a rejection keeps the modal open and shows the error. */
  onConfirm: () => Promise<void>
  onClose: () => void
}

export function ConfirmDeleteModal({ title, message, onConfirm, onClose }: ConfirmDeleteModalProps) {
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const inFlight = useRef(false)

  function close() {
    if (inFlight.current) return
    onClose()
  }

  async function confirm() {
    if (inFlight.current) return
    inFlight.current = true
    setIsDeleting(true)
    setError(null)
    try {
      await onConfirm()
    } catch (confirmError) {
      setError(toUserMessage(confirmError))
    } finally {
      inFlight.current = false
      setIsDeleting(false)
    }
  }

  return (
    <Modal title={title} onClose={close}>
      <fieldset disabled={isDeleting} className="flex flex-col gap-4" aria-busy={isDeleting}>
        <p>{message}</p>
        {error && <ErrorBanner message={error} />}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" autoFocus onClick={close}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={() => void confirm()}>
            {isDeleting ? 'Eliminando…' : 'Eliminar definitivamente'}
          </Button>
        </div>
      </fieldset>
    </Modal>
  )
}
