import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Category, Product } from '../domain/product'
import { ProductFormModal } from './ProductFormModal'
import { ProductsTable } from './ProductsTable'

const categories: Category[] = [{ id: 'cat-1', name: 'Tacos', sortOrder: 1 }]

const product: Product = {
  id: 'p-1',
  categoryId: 'cat-1',
  name: 'Taco',
  priceCents: 5000,
  active: true,
  variants: ['Res', 'Pollo'],
}

function setup(initial?: Product) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  render(<ProductFormModal categories={categories} initial={initial} onSubmit={onSubmit} onClose={onClose} />)
  return { onSubmit, onClose }
}

describe('ProductFormModal variants', () => {
  it('shows the existing variants when editing', () => {
    setup(product)
    expect(screen.getByLabelText('Opciones')).toHaveValue('Res, Pollo')
  })

  it('submits parsed variants', async () => {
    const { onSubmit } = setup()
    await userEvent.type(screen.getByLabelText('Nombre'), 'Taco')
    await userEvent.type(screen.getByLabelText('Precio (MXN)'), '50')
    await userEvent.type(screen.getByLabelText('Opciones'), 'Res, Pollo')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ variants: ['Res', 'Pollo'] }))
  })

  it('rejects duplicate variants without submitting', async () => {
    const { onSubmit } = setup(product)
    const field = screen.getByLabelText('Opciones')
    await userEvent.clear(field)
    await userEvent.type(field, 'Res, res')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Las variantes no pueden repetirse.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits an empty list when the field is cleared', async () => {
    const { onSubmit } = setup(product)
    await userEvent.clear(screen.getByLabelText('Opciones'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ variants: [] }))
  })
})

describe('ProductsTable variants', () => {
  it('shows variants next to the name only when present', () => {
    render(
      <ProductsTable
        products={[product, { ...product, id: 'p-2', name: 'Agua', variants: [] }]}
        categories={categories}
        onEdit={vi.fn()}
        onToggleActive={vi.fn()}
      />,
    )
    expect(screen.getByText('Res · Pollo')).toBeInTheDocument()
    expect(screen.getAllByText(/·/)).toHaveLength(1)
  })
})

describe('ProductFormModal stock', () => {
  it('hides the minimum until tracking is on and submits untracked by default', async () => {
    const { onSubmit } = setup(product)
    expect(screen.getByLabelText('Controlar inventario')).not.toBeChecked()
    expect(screen.queryByLabelText('Stock mínimo')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ trackStock: false, stockMin: 0 }))
  })

  it('submits tracking with its minimum', async () => {
    const { onSubmit } = setup(product)
    await userEvent.click(screen.getByLabelText('Controlar inventario'))
    await userEvent.type(screen.getByLabelText('Stock mínimo'), '12')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ trackStock: true, stockMin: 12 }))
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('stock')
  })

  it('shows the saved tracking and minimum when editing', () => {
    setup({ ...product, trackStock: true, stock: 30, stockMin: 24 })
    expect(screen.getByLabelText('Controlar inventario')).toBeChecked()
    expect(screen.getByLabelText('Stock mínimo')).toHaveValue('24')
  })

  it('rejects an invalid minimum without submitting', async () => {
    const { onSubmit } = setup(product)
    await userEvent.click(screen.getByLabelText('Controlar inventario'))
    await userEvent.type(screen.getByLabelText('Stock mínimo'), '1.5')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('El mínimo debe ser un número entero de 0 o más.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

