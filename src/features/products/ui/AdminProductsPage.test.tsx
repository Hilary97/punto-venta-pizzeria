import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Category, Product } from '../domain/product'
import { listCategories, listProducts } from '../infrastructure/productsRepository'
import { AdminProductsPage } from './AdminProductsPage'

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
    expect(screen.queryByRole('option', { name: 'Pizzas' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Bebidas' })).toBeInTheDocument()
  })

  it('keeps listing products of other categories with their actions', async () => {
    renderPage()
    expect(await screen.findByRole('row', { name: /Refresco/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desactivar' })).toBeInTheDocument()
  })
})
