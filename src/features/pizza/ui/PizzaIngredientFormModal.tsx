import { useState, type FormEvent } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { ingredientFormSchema, type AdminPizzaIngredient, type IngredientFormValues } from '../domain/pizzaAdmin'
import { CHECKBOX_CLASS, parseOrderInput } from './pizzaAdminForm'

interface PizzaIngredientFormModalProps {
  initial?: AdminPizzaIngredient
  defaultSortOrder: number
  onSubmit: (values: IngredientFormValues) => Promise<void>
  onClose: () => void
}

export function PizzaIngredientFormModal({ initial, defaultSortOrder, onSubmit, onClose }: PizzaIngredientFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [orderInput, setOrderInput] = useState(String(initial?.sortOrder ?? defaultSortOrder))
  const [active, setActive] = useState(initial?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = ingredientFormSchema.safeParse({ name, sortOrder: parseOrderInput(orderInput), active })
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
    <Modal title={initial ? 'Editar ingrediente' : 'Nuevo ingrediente'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input id="pizza-ingredient-name" label="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          id="pizza-ingredient-order"
          label="Orden"
          inputMode="numeric"
          value={orderInput}
          onChange={(e) => setOrderInput(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className={CHECKBOX_CLASS} />
          Ingrediente activo
        </label>
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
