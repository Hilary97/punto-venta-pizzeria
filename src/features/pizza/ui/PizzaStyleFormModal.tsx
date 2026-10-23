import { useState, type FormEvent } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { parseMoneyInput } from '../../../shared/money'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { Textarea } from '../../../shared/ui/Textarea'
import type { PizzaSizeCode } from '../domain/pizza'
import {
  MAX_CUSTOM_INGREDIENTS,
  MIN_CUSTOM_INGREDIENTS,
  styleFormSchema,
  type AdminPizzaSize,
  type AdminPizzaStyle,
  type StyleFormValues,
} from '../domain/pizzaAdmin'
import { CHECKBOX_CLASS, SELECT_CLASS, centsToInput, parseOrderInput } from './pizzaAdminForm'

interface PizzaStyleFormModalProps {
  sizes: AdminPizzaSize[]
  initial?: AdminPizzaStyle
  defaultSortOrder: number
  onSubmit: (values: StyleFormValues) => Promise<void>
  onClose: () => void
}

const INCLUDED_OPTIONS = Array.from(
  { length: MAX_CUSTOM_INGREDIENTS - MIN_CUSTOM_INGREDIENTS + 1 },
  (_, index) => MIN_CUSTOM_INGREDIENTS + index,
)

export function PizzaStyleFormModal({ sizes, initial, defaultSortOrder, onSubmit, onClose }: PizzaStyleFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [kind, setKind] = useState<AdminPizzaStyle['kind']>(initial?.kind ?? 'special')
  const [included, setIncluded] = useState(
    String(initial?.kind === 'custom' ? initial.includedIngredients : MIN_CUSTOM_INGREDIENTS + 1),
  )
  const [orderInput, setOrderInput] = useState(String(initial?.sortOrder ?? defaultSortOrder))
  const [active, setActive] = useState(initial?.active ?? true)
  const [priceInputs, setPriceInputs] = useState<Partial<Record<PizzaSizeCode, string>>>(() =>
    Object.fromEntries(sizes.map((size) => [size.code, centsToInput(initial?.prices[size.code])])),
  )
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const prices: Partial<Record<PizzaSizeCode, number>> = {}
    for (const size of sizes) {
      const cents = parseMoneyInput(priceInputs[size.code] ?? '')
      if (cents === null) {
        setError(`Ingresa un precio válido para ${size.name}, por ejemplo 150.50.`)
        return
      }
      prices[size.code] = cents
    }

    const parsed = styleFormSchema.safeParse({
      name,
      description,
      kind,
      includedIngredients: kind === 'custom' ? Number(included) : 0,
      sortOrder: parseOrderInput(orderInput),
      active,
      prices,
    })
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
    <Modal title={initial ? 'Editar estilo' : 'Nuevo estilo'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input id="pizza-style-name" label="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
        <Textarea
          id="pizza-style-description"
          label="Descripción"
          placeholder="Pepperoni, jamón y champiñón"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="flex flex-col gap-1">
          <label htmlFor="pizza-style-kind" className="text-sm font-medium text-slate-700">
            Tipo
          </label>
          <select
            id="pizza-style-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as AdminPizzaStyle['kind'])}
            className={SELECT_CLASS}
          >
            <option value="special">Ingredientes fijos</option>
            <option value="custom">El cliente elige los ingredientes</option>
          </select>
        </div>

        {kind === 'custom' && (
          <div className="flex flex-col gap-1">
            <label htmlFor="pizza-style-included" className="text-sm font-medium text-slate-700">
              Ingredientes a elegir
            </label>
            <select
              id="pizza-style-included"
              value={included}
              onChange={(e) => setIncluded(e.target.value)}
              className={SELECT_CLASS}
            >
              {INCLUDED_OPTIONS.map((count) => (
                <option key={count} value={String(count)}>
                  {count}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {sizes.map((size) => (
            <Input
              key={size.code}
              id={`pizza-style-price-${size.code}`}
              label={`Precio ${size.name} (MXN)`}
              inputMode="decimal"
              placeholder="150.00"
              value={priceInputs[size.code] ?? ''}
              onChange={(e) => setPriceInputs((current) => ({ ...current, [size.code]: e.target.value }))}
            />
          ))}
        </div>

        <Input
          id="pizza-style-order"
          label="Orden"
          inputMode="numeric"
          value={orderInput}
          onChange={(e) => setOrderInput(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className={CHECKBOX_CLASS} />
          Estilo activo
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
