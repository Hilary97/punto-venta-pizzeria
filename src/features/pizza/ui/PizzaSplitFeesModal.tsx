import { useState, type FormEvent } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { parseMoneyInput } from '../../../shared/money'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { splitFeesFormSchema, type SplitFeesFormValues } from '../domain/pizzaAdmin'
import { centsToInput } from './pizzaAdminForm'

interface PizzaSplitFeesModalProps {
  initial: SplitFeesFormValues
  onSubmit: (values: SplitFeesFormValues) => Promise<void>
  onClose: () => void
}

export function PizzaSplitFeesModal({ initial, onSubmit, onClose }: PizzaSplitFeesModalProps) {
  const [halvesInput, setHalvesInput] = useState(centsToInput(initial.halves))
  const [thirdsInput, setThirdsInput] = useState(centsToInput(initial.thirds))
  const [quartersInput, setQuartersInput] = useState(centsToInput(initial.quarters))
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const halves = parseMoneyInput(halvesInput)
    const thirds = parseMoneyInput(thirdsInput)
    const quarters = parseMoneyInput(quartersInput)
    if (halves === null || thirds === null || quarters === null) {
      setError('Ingresa un precio válido, por ejemplo 150.50.')
      return
    }
    const parsed = splitFeesFormSchema.safeParse({ halves, thirds, quarters })
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
    <Modal title="Cargo por elaboración" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input
          id="pizza-split-halves"
          label="Mitades (MXN)"
          inputMode="decimal"
          value={halvesInput}
          onChange={(e) => setHalvesInput(e.target.value)}
        />
        <Input
          id="pizza-split-thirds"
          label="Tercios (MXN)"
          inputMode="decimal"
          value={thirdsInput}
          onChange={(e) => setThirdsInput(e.target.value)}
        />
        <Input
          id="pizza-split-quarters"
          label="Cuartos (MXN)"
          inputMode="decimal"
          value={quartersInput}
          onChange={(e) => setQuartersInput(e.target.value)}
        />
        <p className="text-xs text-slate-500">Se suma a las pizzas divididas con estilos distintos.</p>
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
