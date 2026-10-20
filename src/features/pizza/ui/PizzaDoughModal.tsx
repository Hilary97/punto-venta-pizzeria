import { useState, type FormEvent } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'

interface PizzaDoughModalProps {
  sizeName: string
  prepared: number | null
  onSubmit: (prepared: number) => Promise<void>
  onClose: () => void
}

export function PizzaDoughModal({ sizeName, prepared, onSubmit, onClose }: PizzaDoughModalProps) {
  const [input, setInput] = useState(prepared === null ? '' : String(prepared))
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = input.trim()
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) {
      setError('La cantidad de masas no es válida.')
      return
    }

    setError(null)
    setIsSubmitting(true)
    try {
      await onSubmit(Number(text))
      onClose()
    } catch (submitError) {
      setError(toUserMessage(submitError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal title={`Masas de ${sizeName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input
          id="pizza-dough-prepared"
          label="Masas preparadas"
          inputMode="numeric"
          value={input}
          onChange={(event) => setInput(event.target.value)}
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
