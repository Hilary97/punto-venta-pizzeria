import { useState, type FormEvent } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { categoryFormSchema, type Category, type CategoryFormValues } from '../domain/product'

interface CategoryFormModalProps {
  initial?: Category
  onSubmit: (values: CategoryFormValues) => Promise<void>
  onClose: () => void
}

export function CategoryFormModal({ initial, onSubmit, onClose }: CategoryFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = categoryFormSchema.safeParse({ name })
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
      setError(submitError instanceof Error ? submitError.message : 'No se pudo guardar la categoría.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal title={initial ? 'Editar categoría' : 'Nueva categoría'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input id="category-name" label="Nombre" value={name} onChange={(e) => setName(e.target.value)} required />
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
