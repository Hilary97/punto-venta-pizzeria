import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Supply, SupplyPurchase } from '../domain/supply'
import { purchaseRange } from '../domain/supply'
import {
  countSupply,
  createSupply,
  listPurchases,
  listSupplies,
  recordPurchase,
  updateSupply,
} from '../infrastructure/suppliesRepository'
import { AdminSuppliesPage } from './AdminSuppliesPage'

vi.mock('../infrastructure/suppliesRepository', () => ({
  listSupplies: vi.fn(),
  createSupply: vi.fn(),
  updateSupply: vi.fn(),
  recordPurchase: vi.fn(),
  countSupply: vi.fn(),
  listPurchases: vi.fn(),
}))

function supply(overrides: Partial<Supply>): Supply {
  return { id: 's', name: 'Insumo', unit: 'kg', stock: 10, stockMin: 1, active: true, ...overrides }
}

const harina = supply({ id: 'harina', name: 'Harina', unit: 'kg', stock: 2.5, stockMin: 5 })
const queso = supply({ id: 'queso', name: 'Queso', unit: 'kg', stock: 1, stockMin: 1 })
const cajas = supply({ id: 'cajas', name: 'Cajas', unit: 'pz', stock: 12, stockMin: 4 })
const aceite = supply({ id: 'aceite', name: 'Aceite', unit: 'l', stock: 0.125, stockMin: 0.1 })
const azucar = supply({ id: 'azucar', name: 'Azúcar', unit: 'g', stock: 0, stockMin: 10, active: false })

const purchases: SupplyPurchase[] = [
  {
    id: 'p1',
    supplyId: 'queso',
    supplyName: 'Queso',
    unit: 'kg',
    quantity: 10,
    costCents: 123450,
    createdByName: 'Ana',
    createdAt: '2026-10-19T21:05:00.000Z',
  },
  {
    id: 'p2',
    supplyId: 'cajas',
    supplyName: 'Cajas',
    unit: 'pz',
    quantity: 0.5,
    costCents: 5050,
    createdByName: null,
    createdAt: '2026-10-02T18:00:00.000Z',
  },
]

const defaultRange = purchaseRange('2026-10-01', '2026-10-31')

function suppliesTable() {
  return screen.getByRole('table', { name: 'Lista de insumos' })
}

function rowOf(name: string) {
  const row = within(suppliesTable())
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryAllByRole('cell')[0]?.textContent?.startsWith(name))
  if (!row) throw new Error(`No row for ${name}`)
  return row
}

function cellsOf(name: string) {
  return within(rowOf(name)).getAllByRole('cell').map((cell) => cell.textContent)
}

function totalText(text: string) {
  return screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === text)
}

function setup() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 20, 15, 5) })
  vi.mocked(listSupplies).mockResolvedValue([queso, harina, cajas, aceite, azucar])
  vi.mocked(listPurchases).mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

async function renderPage() {
  render(<AdminSuppliesPage />)
  await screen.findByRole('table', { name: 'Lista de insumos' })
}

describe('AdminSuppliesPage listing (S2, S4)', () => {
  it('lists supplies sorted by name with the expected columns', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { name: 'Insumos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nuevo insumo' })).toBeInTheDocument()
    const headers = within(suppliesTable()).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Insumo', 'Unidad', 'Existencias', 'Mínimo', 'Estado', 'Acciones'])
    const names = within(suppliesTable())
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0]!.textContent)
    expect(names).toEqual(['Aceite', 'Azúcar', 'Cajas', 'Harina', 'Queso'])
  })

  it('formats quantities with up to 3 decimals and the unit label', async () => {
    await renderPage()
    expect(cellsOf('Harina')).toEqual(['Harina', 'kg', '2.5 kg', '5 kg', 'Por comprar', 'CompraConteoEditar'])
    expect(cellsOf('Cajas')).toEqual(['Cajas', 'pz', '12 pz', '4 pz', 'OK', 'CompraConteoEditar'])
    expect(cellsOf('Aceite').slice(2, 5)).toEqual(['0.125 L', '0.1 L', 'OK'])
  })

  it('marks "Por comprar" at or below the minimum and OK above it', async () => {
    await renderPage()
    expect(within(rowOf('Queso')).getByText('Por comprar')).toBeInTheDocument()
    expect(within(rowOf('Cajas')).getByText('OK')).toBeInTheDocument()
  })

  it('shows inactive supplies as Inactivo with only the Editar action', async () => {
    await renderPage()
    expect(cellsOf('Azúcar')).toEqual(['Azúcar', 'g', '0 g', '10 g', 'Inactivo', 'Editar'])
    const row = within(rowOf('Azúcar'))
    expect(row.queryByRole('button', { name: 'Compra' })).not.toBeInTheDocument()
    expect(row.queryByRole('button', { name: 'Conteo' })).not.toBeInTheDocument()
    expect(row.queryByText('Por comprar')).not.toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    expect(within(rowOf('Harina')).queryByText('Inactivo')).not.toBeInTheDocument()
  })

  it('shows the alert with sorted active names only', async () => {
    await renderPage()
    const region = screen.getByRole('region', { name: 'Insumos para comprar' })
    expect(region).toHaveTextContent(/^Para comprar: Harina, Queso$/)
  })

  it('shows no alert when nothing active is low', async () => {
    vi.mocked(listSupplies).mockResolvedValue([cajas, azucar])
    await renderPage()
    expect(screen.queryByText(/Para comprar:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Insumos para comprar' })).not.toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    vi.mocked(listSupplies).mockResolvedValue([])
    render(<AdminSuppliesPage />)
    expect(await screen.findByText('Aún no hay insumos. Agrega el primero con Nuevo insumo.')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Lista de insumos' })).not.toBeInTheDocument()
  })

  it('shows a load error', async () => {
    vi.mocked(listSupplies).mockRejectedValue(new Error('No se pudieron cargar los insumos.'))
    render(<AdminSuppliesPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar los insumos.')
  })
})

describe('AdminSuppliesPage supply form (S3, S4)', () => {
  it('creates a supply without stock and reloads', async () => {
    vi.mocked(createSupply).mockResolvedValue(undefined)
    const user = setup()
    await renderPage()
    await user.click(screen.getByRole('button', { name: 'Nuevo insumo' }))
    const dialog = screen.getByRole('dialog', { name: 'Nuevo insumo' })
    const units = within(within(dialog).getByLabelText('Unidad')).getAllByRole('option').map((o) => o.textContent)
    expect(units).toEqual(['kg', 'g', 'L', 'ml', 'pz'])
    await user.type(within(dialog).getByLabelText('Nombre'), '  Tomate ')
    await user.selectOptions(within(dialog).getByLabelText('Unidad'), 'g')
    await user.type(within(dialog).getByLabelText('Mínimo'), '2,5')
    const callsBefore = vi.mocked(listSupplies).mock.calls.length
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    expect(createSupply).toHaveBeenCalledWith({ name: 'Tomate', unit: 'g', stockMin: 2.5, active: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(vi.mocked(listSupplies).mock.calls.length).toBe(callsBefore + 1)
  })

  it('treats an empty minimum as 0', async () => {
    vi.mocked(createSupply).mockResolvedValue(undefined)
    const user = setup()
    await renderPage()
    await user.click(screen.getByRole('button', { name: 'Nuevo insumo' }))
    await user.type(screen.getByLabelText('Nombre'), 'Sal')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(createSupply).toHaveBeenCalledWith({ name: 'Sal', unit: 'kg', stockMin: 0, active: true })
  })

  it('edits a supply with its current values and no stock', async () => {
    vi.mocked(updateSupply).mockResolvedValue(undefined)
    const user = setup()
    await renderPage()
    await user.click(within(rowOf('Harina')).getByRole('button', { name: 'Editar' }))
    const dialog = screen.getByRole('dialog', { name: 'Editar insumo' })
    expect(within(dialog).getByLabelText('Nombre')).toHaveValue('Harina')
    expect(within(dialog).getByLabelText('Unidad')).toHaveValue('kg')
    expect(within(dialog).getByLabelText('Mínimo')).toHaveValue('5')
    expect(within(dialog).getByLabelText('Insumo activo')).toBeChecked()
    await user.clear(within(dialog).getByLabelText('Mínimo'))
    await user.type(within(dialog).getByLabelText('Mínimo'), '7.5')
    await user.click(within(dialog).getByLabelText('Insumo activo'))
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    expect(updateSupply).toHaveBeenCalledWith('harina', { name: 'Harina', unit: 'kg', stockMin: 7.5, active: false })
  })

  it('rejects an empty name without calling', async () => {
    const user = setup()
    await renderPage()
    await user.click(screen.getByRole('button', { name: 'Nuevo insumo' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('El nombre es obligatorio.')).toBeInTheDocument()
    expect(createSupply).not.toHaveBeenCalled()
  })

  it.each([['abc'], ['-1'], ['1.2345']])('rejects minimum %j without calling', async (value) => {
    const user = setup()
    await renderPage()
    await user.click(screen.getByRole('button', { name: 'Nuevo insumo' }))
    await user.type(screen.getByLabelText('Nombre'), 'Sal')
    await user.type(screen.getByLabelText('Mínimo'), value)
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('El mínimo debe ser 0 o más, con hasta 3 decimales.')).toBeInTheDocument()
    expect(createSupply).not.toHaveBeenCalled()
  })

  it('keeps the modal open and shows the server error', async () => {
    vi.mocked(createSupply).mockRejectedValue(new Error('No se pudo crear el insumo.'))
    const user = setup()
    await renderPage()
    await user.click(screen.getByRole('button', { name: 'Nuevo insumo' }))
    await user.type(screen.getByLabelText('Nombre'), 'Harina')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('No se pudo crear el insumo.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Nuevo insumo' })).toBeInTheDocument()
  })
})

describe('AdminSuppliesPage Compra (S4)', () => {
  async function openCompra(user: ReturnType<typeof setup>, name = 'Harina') {
    await user.click(within(rowOf(name)).getByRole('button', { name: 'Compra' }))
  }

  it('records a purchase then reloads supplies and history', async () => {
    vi.mocked(recordPurchase).mockResolvedValue({ supplyId: 'harina', stock: 5 })
    const user = setup()
    await renderPage()
    await openCompra(user)
    expect(screen.getByRole('dialog', { name: 'Compra de Harina' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Cantidad recibida (kg)'), '2,5')
    await user.type(screen.getByLabelText('Monto pagado (MXN)'), '450.50')
    const suppliesCalls = vi.mocked(listSupplies).mock.calls.length
    const purchaseCalls = vi.mocked(listPurchases).mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(recordPurchase).toHaveBeenCalledWith('harina', 2.5, 45050)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(vi.mocked(listSupplies).mock.calls.length).toBe(suppliesCalls + 1)
    expect(vi.mocked(listPurchases).mock.calls.length).toBe(purchaseCalls + 1)
  })

  it('accepts a free purchase of 0', async () => {
    vi.mocked(recordPurchase).mockResolvedValue({ supplyId: 'cajas', stock: 13 })
    const user = setup()
    await renderPage()
    await openCompra(user, 'Cajas')
    await user.type(screen.getByLabelText('Cantidad recibida (pz)'), '1')
    await user.type(screen.getByLabelText('Monto pagado (MXN)'), '0')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(recordPurchase).toHaveBeenCalledWith('cajas', 1, 0)
  })

  it('shows the decimal hint under the quantity', async () => {
    const user = setup()
    await renderPage()
    await openCompra(user)
    expect(screen.getByText('Usa punto o coma para decimales, sin separador de miles.')).toBeInTheDocument()
  })

  it.each([[''], ['0'], ['abc'], ['1.2345'], ['1,000']])('rejects quantity %j without calling', async (quantity) => {
    const user = setup()
    await renderPage()
    await openCompra(user)
    if (quantity) await user.type(screen.getByLabelText('Cantidad recibida (kg)'), quantity)
    await user.type(screen.getByLabelText('Monto pagado (MXN)'), '10')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('La cantidad debe ser mayor a cero.')).toBeInTheDocument()
    expect(recordPurchase).not.toHaveBeenCalled()
  })

  it('rejects a quantity beyond the column range without calling', async () => {
    const user = setup()
    await renderPage()
    await openCompra(user)
    await user.type(screen.getByLabelText('Cantidad recibida (kg)'), '1000000000')
    await user.type(screen.getByLabelText('Monto pagado (MXN)'), '10')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('La cantidad es demasiado grande.')).toBeInTheDocument()
    expect(recordPurchase).not.toHaveBeenCalled()
  })

  it('rejects an amount beyond the integer range without calling', async () => {
    const user = setup()
    await renderPage()
    await openCompra(user)
    await user.type(screen.getByLabelText('Cantidad recibida (kg)'), '2')
    await user.type(screen.getByLabelText('Monto pagado (MXN)'), '20000000.01')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('El monto pagado es demasiado grande.')).toBeInTheDocument()
    expect(recordPurchase).not.toHaveBeenCalled()
  })

  it.each([[''], ['abc'], ['1,85'], ['-5']])('rejects amount %j without calling', async (amount) => {
    const user = setup()
    await renderPage()
    await openCompra(user)
    await user.type(screen.getByLabelText('Cantidad recibida (kg)'), '2')
    if (amount) await user.type(screen.getByLabelText('Monto pagado (MXN)'), amount)
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('El monto pagado no es válido.')).toBeInTheDocument()
    expect(recordPurchase).not.toHaveBeenCalled()
  })

  it('keeps the modal open and shows the server error', async () => {
    vi.mocked(recordPurchase).mockRejectedValue(new Error('No se pudo registrar la compra.'))
    const user = setup()
    await renderPage()
    await openCompra(user)
    await user.type(screen.getByLabelText('Cantidad recibida (kg)'), '2')
    await user.type(screen.getByLabelText('Monto pagado (MXN)'), '10')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('No se pudo registrar la compra.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Compra de Harina' })).toBeInTheDocument()
  })
})

describe('AdminSuppliesPage Conteo (S4)', () => {
  async function openConteo(user: ReturnType<typeof setup>, name = 'Harina') {
    await user.click(within(rowOf(name)).getByRole('button', { name: 'Conteo' }))
  }

  it('prefills the current stock, counts and reloads', async () => {
    vi.mocked(countSupply).mockResolvedValue({ supplyId: 'harina', stock: 3.25 })
    const user = setup()
    await renderPage()
    await openConteo(user)
    expect(screen.getByRole('dialog', { name: 'Conteo de Harina' })).toBeInTheDocument()
    const field = screen.getByLabelText('Existencias contadas (kg)')
    expect(field).toHaveValue('2.5')
    await user.clear(field)
    await user.type(field, '3,25')
    const suppliesCalls = vi.mocked(listSupplies).mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(countSupply).toHaveBeenCalledWith('harina', 3.25)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(vi.mocked(listSupplies).mock.calls.length).toBe(suppliesCalls + 1)
  })

  it('rejects a count beyond the column range without calling', async () => {
    const user = setup()
    await renderPage()
    await openConteo(user)
    await user.clear(screen.getByLabelText('Existencias contadas (kg)'))
    await user.type(screen.getByLabelText('Existencias contadas (kg)'), '1000000000')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('La cantidad es demasiado grande.')).toBeInTheDocument()
    expect(countSupply).not.toHaveBeenCalled()
  })

  it('accepts a count of zero', async () => {
    vi.mocked(countSupply).mockResolvedValue({ supplyId: 'harina', stock: 0 })
    const user = setup()
    await renderPage()
    await openConteo(user)
    await user.clear(screen.getByLabelText('Existencias contadas (kg)'))
    await user.type(screen.getByLabelText('Existencias contadas (kg)'), '0')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(countSupply).toHaveBeenCalledWith('harina', 0)
  })

  it.each([['-2'], ['abc'], ['']])('rejects %j without calling', async (value) => {
    const user = setup()
    await renderPage()
    await openConteo(user)
    await user.clear(screen.getByLabelText('Existencias contadas (kg)'))
    if (value) await user.type(screen.getByLabelText('Existencias contadas (kg)'), value)
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('El conteo no puede ser negativo.')).toBeInTheDocument()
    expect(countSupply).not.toHaveBeenCalled()
  })

  it('keeps the modal open and shows the server error', async () => {
    vi.mocked(countSupply).mockRejectedValue(new Error('No se pudo registrar el conteo.'))
    const user = setup()
    await renderPage()
    await openConteo(user)
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('No se pudo registrar el conteo.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Conteo de Harina' })).toBeInTheDocument()
  })
})

describe('AdminSuppliesPage purchases history (S5)', () => {
  it('loads the current month by default and lists purchases with the total', async () => {
    vi.mocked(listPurchases).mockResolvedValue(purchases)
    await renderPage()
    expect(screen.getByRole('heading', { name: 'Historial de compras' })).toBeInTheDocument()
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-10-01')
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-10-31')
    expect(listPurchases).toHaveBeenCalledWith(defaultRange.from, defaultRange.to)
    const table = await screen.findByRole('table', { name: 'Compras' })
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Fecha', 'Insumo', 'Cantidad', 'Pagado', 'Registró'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(within(rows[0]!).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      new Date(purchases[0]!.createdAt).toLocaleString('es-MX'),
      'Queso',
      '10 kg',
      '$1,234.50',
      'Ana',
    ])
    expect(within(rows[1]!).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      new Date(purchases[1]!.createdAt).toLocaleString('es-MX'),
      'Cajas',
      '0.5 pz',
      '$50.50',
      '—',
    ])
    expect(totalText('Total gastado: $1,285.00')).toBeInTheDocument()
  })

  it('shows the empty state with a zero total', async () => {
    render(<AdminSuppliesPage />)
    expect(await screen.findByText('No hay compras en este rango.')).toBeInTheDocument()
    expect(totalText('Total gastado: $0.00')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Compras' })).not.toBeInTheDocument()
  })

  it('reloads when either date changes', async () => {
    await renderPage()
    await screen.findByText('No hay compras en este rango.')
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-05' } })
    const fromRange = purchaseRange('2026-10-05', '2026-10-31')
    expect(await screen.findByText('No hay compras en este rango.')).toBeInTheDocument()
    expect(listPurchases).toHaveBeenLastCalledWith(fromRange.from, fromRange.to)
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-20' } })
    const toRange = purchaseRange('2026-10-05', '2026-10-20')
    expect(await screen.findByText('No hay compras en este rango.')).toBeInTheDocument()
    expect(listPurchases).toHaveBeenLastCalledWith(toRange.from, toRange.to)
  })

  it('shows a message and does not call for an inverted range', async () => {
    await renderPage()
    await screen.findByText('No hay compras en este rango.')
    const calls = vi.mocked(listPurchases).mock.calls.length
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-05' } })
    expect(await screen.findByText('El rango de fechas no es válido.')).toBeInTheDocument()
    expect(vi.mocked(listPurchases).mock.calls.length).toBe(calls)
    expect(screen.queryByText(/Total gastado/)).not.toBeInTheDocument()
  })

  it('shows a history load error', async () => {
    vi.mocked(listPurchases).mockRejectedValue(new Error('No se pudo cargar el historial de compras.'))
    render(<AdminSuppliesPage />)
    expect(await screen.findByText('No se pudo cargar el historial de compras.')).toBeInTheDocument()
  })
})
