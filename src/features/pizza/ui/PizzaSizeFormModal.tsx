import { useState, type FormEvent } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { portionLabel } from '../domain/pizza'
import { MAX_PORTIONS, sizeFormSchema, type AdminPizzaSize, type SizeFormValues } from '../domain/pizzaAdmin'
import { CHECKBOX_CLASS } from './pizzaAdminForm'

const PORTION_OPTIONS = Array.from({ length: MAX_PORTIONS }, (_, index) => index + 1)

interface PizzaSizeFormModalProps {
  size: AdminPizzaSize
  onSubmit: (values: SizeFormValues) => Promise<void>
  onClose: () => void
}

export function PizzaSizeFormModal({ size, onSubmit, onClose }: PizzaSizeFormModalProps) {
  const [name, setName] = useState(size.name)
  const [portions, setPortions] = useState<number[]>(size.allowedPortions)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function togglePortion(count: number) {
    setPortions((current) =>
      current.includes(count) ? current.filter((value) => value !== count) : [...current, count].sort((a, b) => a - b),
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = sizeFormSchema.safeParse({ name, allowedPortions: portions })
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
    <Modal title={`Editar tamaño ${size.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input id="pizza-size-name" label="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-slate-700">Se puede pedir</legend>
          {PORTION_OPTIONS.map((count) => (
            <label key={count} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={portions.includes(count)}
                onChange={() => togglePortion(count)}
                className={CHECKBOX_CLASS}
              />
              {portionLabel(count)}
            </label>
          ))}
        </fieldset>
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
