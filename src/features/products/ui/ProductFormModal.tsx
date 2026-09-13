import { useState, type FormEvent } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { parseMoneyInput, formatMoney } from '../../../shared/money'
import { productFormSchema, type Category, type Product, type ProductFormValues } from '../domain/product'

interface ProductFormModalProps {
  categories: Category[]
  initial?: Product
  onSubmit: (values: ProductFormValues) => Promise<void>
  onClose: () => void
}

export function ProductFormModal({ categories, initial, onSubmit, onClose }: ProductFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? '')
  const [priceInput, setPriceInput] = useState(initial ? formatMoney(initial.priceCents).replace('$', '') : '')
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

    const parsed = productFormSchema.safeParse({ name, categoryId, priceCents, active })
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
      setError(submitError instanceof Error ? submitError.message : 'No se pudo guardar el producto.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal title={initial ? 'Editar producto' : 'Nuevo producto'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input id="product-name" label="Nombre" value={name} onChange={(e) => setName(e.target.value)} required />

        <div className="flex flex-col gap-1">
          <label htmlFor="product-category" className="text-sm font-medium text-slate-700">
            Categoría
          </label>
          <select
            id="product-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900 focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-200"
            required
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <Input
          id="product-price"
          label="Precio (MXN)"
          inputMode="decimal"
          placeholder="150.00"
          value={priceInput}
          onChange={(e) => setPriceInput(e.target.value)}
          required
        />

        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-red-700 focus:ring-red-500"
          />
          Producto activo
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
