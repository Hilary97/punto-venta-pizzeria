import { useState, type FormEvent } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { parseMoneyInput } from '../../../shared/money'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { extraFormSchema, type AdminPizzaExtra, type ExtraFormValues } from '../domain/pizzaAdmin'
import { CHECKBOX_CLASS, centsToInput, parseOrderInput } from './pizzaAdminForm'

interface PizzaExtraFormModalProps {
  initial?: AdminPizzaExtra
  defaultSortOrder: number
  onSubmit: (values: ExtraFormValues) => Promise<void>
  onClose: () => void
}

export function PizzaExtraFormModal({ initial, defaultSortOrder, onSubmit, onClose }: PizzaExtraFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [priceInput, setPriceInput] = useState(centsToInput(initial?.priceCents))
  const [orderInput, setOrderInput] = useState(String(initial?.sortOrder ?? defaultSortOrder))
  const [active, setActive] = useState(initial?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const priceCents = parseMoneyInput(priceInput)
    if (priceCents === null) {
      setError('Ingresa un precio válido, por ejemplo 150.50.')
      return
    }
    const parsed = extraFormSchema.safeParse({ name, priceCents, sortOrder: parseOrderInput(orderInput), active })
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
    <Modal title={initial ? 'Editar extra' : 'Nuevo extra'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input id="pizza-extra-name" label="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          id="pizza-extra-price"
          label="Precio (MXN)"
          inputMode="decimal"
          value={priceInput}
          onChange={(e) => setPriceInput(e.target.value)}
        />
        <p className="text-xs text-slate-500">Se cobra por porción de la pizza.</p>
        <Input
          id="pizza-extra-order"
          label="Orden"
          inputMode="numeric"
          value={orderInput}
          onChange={(e) => setOrderInput(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className={CHECKBOX_CLASS} />
          Extra activo
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
