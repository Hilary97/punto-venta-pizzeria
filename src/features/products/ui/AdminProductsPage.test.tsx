import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Category, Product } from '../domain/product'
import { listCategories, listProducts } from '../infrastructure/productsRepository'
import {
  addCategoryNoteShortcut,
  deleteNoteShortcut,
  listAdminCategoryNoteShortcuts,
  moveNoteShortcut,
} from '../../pizza/infrastructure/noteShortcutAdminRepository'
import { AdminProductsPage } from './AdminProductsPage'

vi.mock('../../pizza/infrastructure/noteShortcutAdminRepository', () => ({
  listAdminCategoryNoteShortcuts: vi.fn(),
  addCategoryNoteShortcut: vi.fn(),
  deleteNoteShortcut: vi.fn(),
  moveNoteShortcut: vi.fn(),
}))

vi.mock('../infrastructure/productsRepository', () => ({
  listCategories: vi.fn(),
  listProducts: vi.fn(),
  createCategory: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  setProductActive: vi.fn(),
}))

const categories: Category[] = [
  { id: 'pizzas', name: 'Pizzas', sortOrder: 0, legacyPizza: true },
  { id: 'drinks', name: 'Bebidas', sortOrder: 1 },
]

function product(overrides: Partial<Product>): Product {
  return { id: 'p', categoryId: 'drinks', name: 'Producto', priceCents: 2000, active: true, variants: [], ...overrides }
}

const legacyPizza = product({ id: 'varas', categoryId: 'pizzas', name: 'Estilo Varas grande', priceCents: 25000 })
const cola = product({ id: 'cola', name: 'Refresco' })

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminProductsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(listCategories).mockResolvedValue(categories)
  vi.mocked(listProducts).mockResolvedValue([legacyPizza, cola])
  vi.mocked(listAdminCategoryNoteShortcuts).mockResolvedValue([
    { id: 'a', label: 'Sin hielo' },
    { id: 'b', label: 'Poco azúcar' },
  ])
  vi.mocked(addCategoryNoteShortcut).mockResolvedValue(undefined)
  vi.mocked(deleteNoteShortcut).mockResolvedValue(undefined)
  vi.mocked(moveNoteShortcut).mockResolvedValue(undefined)
})

describe('AdminProductsPage legacy pizzas', () => {
  it('hides the legacy Pizzas category products and points to the pizza admin', async () => {
    renderPage()
    expect(await screen.findByText('Refresco')).toBeInTheDocument()
    expect(screen.queryByText('Estilo Varas grande')).not.toBeInTheDocument()
    expect(screen.getByText(/Las pizzas se administran en/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pizzas' })).toHaveAttribute('href', '/admin/pizzas')
  })

  it('does not offer the legacy Pizzas category when creating a product', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo producto' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('option', { name: 'Pizzas' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('option', { name: 'Bebidas' })).toBeInTheDocument()
  })

  it('keeps listing products of other categories with their actions', async () => {
    renderPage()
    expect(await screen.findByRole('row', { name: /Refresco/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desactivar' })).toBeInTheDocument()
  })
})

describe('AdminProductsPage category note shortcuts', () => {
  async function section() {
    renderPage()
    return screen.findByRole('region', { name: 'Atajos de notas por categoría' })
  }

  it('offers the categories (not the legacy Pizzas one) and lists the first one', async () => {
    const region = await section()
    const select = within(region).getByLabelText('Categoría')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Bebidas'])
    expect(await within(region).findByText('Sin hielo')).toBeVisible()
    expect(listAdminCategoryNoteShortcuts).toHaveBeenCalledWith('drinks')
  })

  it('loads the list of the chosen category', async () => {
    vi.mocked(listCategories).mockResolvedValue([...categories, { id: 'burgers', name: 'Hamburguesas', sortOrder: 2 }])
    const region = await section()
    await within(region).findByText('Sin hielo')
    await userEvent.selectOptions(within(region).getByLabelText('Categoría'), 'burgers')
    expect(listAdminCategoryNoteShortcuts).toHaveBeenLastCalledWith('burgers')
  })

  it('adds a trimmed label to the chosen category, clears the field and reloads', async () => {
    const user = userEvent.setup()
    const region = await section()
    await within(region).findByText('Sin hielo')
    expect(within(region).getByRole('button', { name: 'Agregar atajo' })).toBeDisabled()
    expect(within(region).getByLabelText('Nuevo atajo')).toHaveAttribute('maxlength', '40')
    await user.type(within(region).getByLabelText('Nuevo atajo'), '  Con limón ')
    await user.click(within(region).getByRole('button', { name: 'Agregar atajo' }))
    expect(addCategoryNoteShortcut).toHaveBeenCalledWith('drinks', 'Con limón')
    expect(listAdminCategoryNoteShortcuts).toHaveBeenCalledTimes(2)
    expect(within(region).getByLabelText('Nuevo atajo')).toHaveValue('')
  })

  it('shows the server message and keeps the typed text when adding fails', async () => {
    vi.mocked(addCategoryNoteShortcut).mockRejectedValue(new Error('Puedes tener hasta 12 atajos por categoría.'))
    const user = userEvent.setup()
    const region = await section()
    await within(region).findByText('Sin hielo')
    await user.type(within(region).getByLabelText('Nuevo atajo'), 'Otro')
    await user.click(within(region).getByRole('button', { name: 'Agregar atajo' }))
    expect(await within(region).findByText('Puedes tener hasta 12 atajos por categoría.')).toBeVisible()
    expect(within(region).getByLabelText('Nuevo atajo')).toHaveValue('Otro')
  })

  it('moves and removes', async () => {
    const user = userEvent.setup()
    const region = await section()
    await within(region).findByText('Sin hielo')
    const rows = within(region).getAllByRole('listitem')
    expect(within(rows[0]!).getByRole('button', { name: 'Subir' })).toBeDisabled()
    await user.click(within(rows[1]!).getByRole('button', { name: 'Subir' }))
    expect(moveNoteShortcut).toHaveBeenCalledWith('b', -1)
    await user.click(within(rows[0]!).getByRole('button', { name: 'Bajar' }))
    expect(moveNoteShortcut).toHaveBeenLastCalledWith('a', 1)
    await user.click(within(rows[0]!).getByRole('button', { name: 'Quitar' }))
    expect(deleteNoteShortcut).toHaveBeenCalledWith('a')
  })

  it('shows an empty hint for a category without shortcuts', async () => {
    vi.mocked(listAdminCategoryNoteShortcuts).mockResolvedValue([])
    const region = await section()
    expect(await within(region).findByText(/Esta categoría no tiene atajos/)).toBeVisible()
  })
})
