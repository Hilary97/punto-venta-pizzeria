import { useState, type FormEvent } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { parseMoneyInput } from '../../../shared/money'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { extraIngredientPriceFormSchema, type ExtraIngredientPriceFormValues } from '../domain/pizzaAdmin'
import { centsToInput } from './pizzaAdminForm'

interface PizzaExtraIngredientPriceModalProps {
  initialCents: number
  onSubmit: (values: ExtraIngredientPriceFormValues) => Promise<void>
  onClose: () => void
}

export function PizzaExtraIngredientPriceModal({ initialCents, onSubmit, onClose }: PizzaExtraIngredientPriceModalProps) {
  const [ingredientInput, setIngredientInput] = useState(centsToInput(initialCents))
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const extraIngredientCents = parseMoneyInput(ingredientInput)
    if (extraIngredientCents === null) {
      setError('Ingresa un precio válido, por ejemplo 150.50.')
      return
    }
    const parsed = extraIngredientPriceFormSchema.safeParse({ extraIngredientCents })
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
    <Modal title="Precio de ingrediente extra" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input
          id="pizza-extra-ingredient"
          label="Ingrediente extra (MXN)"
          inputMode="decimal"
          value={ingredientInput}
          onChange={(e) => setIngredientInput(e.target.value)}
        />
        <p className="text-xs text-slate-500">Se cobra por porción de la pizza.</p>
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
