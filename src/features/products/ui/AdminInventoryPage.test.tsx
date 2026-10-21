import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Product } from '../domain/product'
import { countStock, listProducts, receiveStock } from '../infrastructure/productsRepository'
import { AdminInventoryPage } from './AdminInventoryPage'

vi.mock('../infrastructure/productsRepository', () => ({
  listProducts: vi.fn(),
  receiveStock: vi.fn(),
  countStock: vi.fn(),
}))

vi.mock('../../pizza/ui/PizzaDoughSection', () => ({
  PizzaDoughSection: () => <section aria-label="Masas del día" />,
}))

vi.mock('../../orders/ui/ScheduledLeadSection', () => ({
  ScheduledLeadSection: () => <section aria-label="Pedidos programados" />,
}))

function product(overrides: Partial<Product>): Product {
  return {
    id: 'p',
    categoryId: 'c1',
    name: 'Producto',
    priceCents: 2000,
    active: true,
    variants: [],
    trackStock: true,
    stock: 20,
    stockMin: 5,
    ...overrides,
  }
}

const cola = product({ id: 'cola', name: 'Refresco', stock: 3, stockMin: 12 })
const beer = product({ id: 'beer', name: 'Cerveza', stock: 0, stockMin: 24, active: false })
const water = product({ id: 'water', name: 'Agua', stock: 30, stockMin: 10 })
const pizza = product({ id: 'pizza', name: 'Pizza', trackStock: false, stock: 0, stockMin: 0 })

function rowOf(name: string) {
  return screen.getByRole('row', { name: new RegExp(name) })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(listProducts).mockResolvedValue([cola, beer, water, pizza])
})

describe('AdminInventoryPage listing', () => {
  it('lists only tracked products sorted by name with stock, minimum and status', async () => {
    render(<AdminInventoryPage />)
    expect(await screen.findByRole('heading', { name: 'Inventario' })).toBeInTheDocument()
    expect(screen.queryByText('Pizza')).not.toBeInTheDocument()
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('cell')[0]!.textContent)).toEqual(['Agua', 'Cerveza', 'Refresco'])
    expect(within(rowOf('Agua')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Agua', '30', '10', 'OK', 'EntradaConteo'])
    expect(within(rowOf('Refresco')).getByText('3')).toBeInTheDocument()
    expect(within(rowOf('Refresco')).getByText('12')).toBeInTheDocument()
    expect(within(rowOf('Refresco')).getByText('Stock bajo')).toBeInTheDocument()
    expect(within(rowOf('Cerveza')).getByText('Agotado')).toBeInTheDocument()
  })

  it('renders the pizza dough section below the products', async () => {
    render(<AdminInventoryPage />)
    expect(await screen.findByRole('region', { name: 'Masas del día' })).toBeInTheDocument()
  })

  it('shows the low-stock alert with sorted names', async () => {
    render(<AdminInventoryPage />)
    expect(await screen.findByText('Productos por reponer: Cerveza, Refresco')).toBeInTheDocument()
  })

  it('shows no alert when every product is OK', async () => {
    vi.mocked(listProducts).mockResolvedValue([water])
    render(<AdminInventoryPage />)
    await screen.findByText('Agua')
    expect(screen.queryByText(/Productos por reponer/)).not.toBeInTheDocument()
  })

  it('shows the empty state when no product tracks stock', async () => {
    vi.mocked(listProducts).mockResolvedValue([pizza])
    render(<AdminInventoryPage />)
    expect(await screen.findByText('Ningún producto controla inventario. Actívalo en Productos.')).toBeInTheDocument()
  })

  it('shows a load error', async () => {
    vi.mocked(listProducts).mockRejectedValue(new Error('No se pudieron cargar los productos.'))
    render(<AdminInventoryPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar los productos.')
  })
})

describe('AdminInventoryPage Entrada', () => {
  it('receives stock then reloads and shows the new stock', async () => {
    vi.mocked(receiveStock).mockResolvedValue({ productId: 'cola', stock: 27 })
    const user = userEvent.setup()
    render(<AdminInventoryPage />)
    await screen.findByText('Refresco')
    vi.mocked(listProducts).mockResolvedValue([{ ...cola, stock: 27 }, beer, water, pizza])
    await user.click(within(rowOf('Refresco')).getByRole('button', { name: 'Entrada' }))
    expect(screen.getByText('Entrada de Refresco')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Cantidad recibida'), '24')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(receiveStock).toHaveBeenCalledWith('cola', 24)
    expect(await screen.findByText('27')).toBeInTheDocument()
    expect(screen.queryByText('Entrada de Refresco')).not.toBeInTheDocument()
    expect(within(rowOf('Refresco')).getByText('OK')).toBeInTheDocument()
    expect(screen.getByText('Productos por reponer: Cerveza')).toBeInTheDocument()
  })

  it.each([['0'], ['1.5'], ['']])('rejects %j without calling the RPC', async (value) => {
    const user = userEvent.setup()
    render(<AdminInventoryPage />)
    await screen.findByText('Refresco')
    await user.click(within(rowOf('Refresco')).getByRole('button', { name: 'Entrada' }))
    if (value) await user.type(screen.getByLabelText('Cantidad recibida'), value)
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('La cantidad debe ser mayor a cero.')).toBeInTheDocument()
    expect(receiveStock).not.toHaveBeenCalled()
  })

  it('keeps the modal open and shows the server error', async () => {
    vi.mocked(receiveStock).mockRejectedValue(new Error('El producto no controla inventario.'))
    const user = userEvent.setup()
    render(<AdminInventoryPage />)
    await screen.findByText('Refresco')
    await user.click(within(rowOf('Refresco')).getByRole('button', { name: 'Entrada' }))
    await user.type(screen.getByLabelText('Cantidad recibida'), '5')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('El producto no controla inventario.')).toBeInTheDocument()
    expect(screen.getByText('Entrada de Refresco')).toBeInTheDocument()
  })
})

describe('AdminInventoryPage Conteo', () => {
  it('prefills the current stock and counts', async () => {
    vi.mocked(countStock).mockResolvedValue({ productId: 'cola', stock: 17 })
    const user = userEvent.setup()
    render(<AdminInventoryPage />)
    await screen.findByText('Refresco')
    await user.click(within(rowOf('Refresco')).getByRole('button', { name: 'Conteo' }))
    expect(screen.getByText('Conteo de Refresco')).toBeInTheDocument()
    const field = screen.getByLabelText('Existencias contadas')
    expect(field).toHaveValue('3')
    await user.clear(field)
    await user.type(field, '17')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(countStock).toHaveBeenCalledWith('cola', 17)
    expect(screen.queryByText('Conteo de Refresco')).not.toBeInTheDocument()
  })

  it('accepts a count of zero', async () => {
    vi.mocked(countStock).mockResolvedValue({ productId: 'cola', stock: 0 })
    const user = userEvent.setup()
    render(<AdminInventoryPage />)
    await screen.findByText('Refresco')
    await user.click(within(rowOf('Refresco')).getByRole('button', { name: 'Conteo' }))
    await user.clear(screen.getByLabelText('Existencias contadas'))
    await user.type(screen.getByLabelText('Existencias contadas'), '0')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(countStock).toHaveBeenCalledWith('cola', 0)
  })

  it('rejects a negative count without calling the RPC', async () => {
    const user = userEvent.setup()
    render(<AdminInventoryPage />)
    await screen.findByText('Refresco')
    await user.click(within(rowOf('Refresco')).getByRole('button', { name: 'Conteo' }))
    await user.clear(screen.getByLabelText('Existencias contadas'))
    await user.type(screen.getByLabelText('Existencias contadas'), '-2')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('El conteo no puede ser negativo.')).toBeInTheDocument()
    expect(countStock).not.toHaveBeenCalled()
  })

  it('keeps the modal open and shows the server error', async () => {
    vi.mocked(countStock).mockRejectedValue(new Error('El producto no controla inventario.'))
    const user = userEvent.setup()
    render(<AdminInventoryPage />)
    await screen.findByText('Refresco')
    await user.click(within(rowOf('Refresco')).getByRole('button', { name: 'Conteo' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('El producto no controla inventario.')).toBeInTheDocument()
    expect(screen.getByText('Conteo de Refresco')).toBeInTheDocument()
  })
})
