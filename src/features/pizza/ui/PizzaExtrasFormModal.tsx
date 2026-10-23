import { useState, type FormEvent } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { parseMoneyInput } from '../../../shared/money'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { extrasFormSchema, type ExtrasFormValues, type PizzaExtras } from '../domain/pizzaAdmin'
import { centsToInput } from './pizzaAdminForm'

interface PizzaExtrasFormModalProps {
  initial: PizzaExtras
  onSubmit: (values: ExtrasFormValues) => Promise<void>
  onClose: () => void
}

export function PizzaExtrasFormModal({ initial, onSubmit, onClose }: PizzaExtrasFormModalProps) {
  const [ingredientInput, setIngredientInput] = useState(centsToInput(initial.extraIngredientCents))
  const [cheeseInput, setCheeseInput] = useState(centsToInput(initial.extraCheeseCents))
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const extraIngredientCents = parseMoneyInput(ingredientInput)
    const extraCheeseCents = parseMoneyInput(cheeseInput)
    if (extraIngredientCents === null || extraCheeseCents === null) {
      setError('Ingresa un precio válido, por ejemplo 150.50.')
      return
    }
    const parsed = extrasFormSchema.safeParse({ extraIngredientCents, extraCheeseCents })
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
    <Modal title="Precios de extras" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input
          id="pizza-extra-ingredient"
          label="Ingrediente extra (MXN)"
          inputMode="decimal"
          value={ingredientInput}
          onChange={(e) => setIngredientInput(e.target.value)}
        />
        <Input
          id="pizza-extra-cheese"
          label="Extra queso (MXN)"
          inputMode="decimal"
          value={cheeseInput}
          onChange={(e) => setCheeseInput(e.target.value)}
        />
        <p className="text-xs text-slate-500">Se cobran por porción de la pizza.</p>
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
