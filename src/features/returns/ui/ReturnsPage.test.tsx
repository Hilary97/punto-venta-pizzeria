import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as returnsRepository from '../infrastructure/returnsRepository'
import { formatMoney } from '../../../shared/money'
import { ReturnsPage } from './ReturnsPage'

vi.mock('../infrastructure/returnsRepository', () => ({
  listSessionSalesWithItems: vi.fn(),
  createReturn: vi.fn(),
}))

vi.mock('../../cash-register/ui/CashSessionContext', () => ({
  useCashSession: () => ({ state: { session: { id: 'session-1' } } }),
}))

const sales = [
  {
    id: 'aaaaaaaa-1111-4000-8000-000000000001',
    createdAt: '2026-09-01T13:00:00Z',
    totalCents: 30000,
    receivedCents: 50000,
    changeCents: 20000,
    customerName: 'María López',
    tableNumber: 7,
    waiterName: 'Carlos',
    items: [
      { id: 'i1', productId: 'p1', productName: 'Pizza Hawaiana', unitPriceCents: 15000, quantity: 2, returnedQuantity: 1 },
      { id: 'i2', productId: 'p2', productName: 'Refresco', unitPriceCents: 0, quantity: 1, returnedQuantity: 0 },
    ],
  },
  {
    id: 'bbbbbbbb-2222-4000-8000-000000000002',
    createdAt: '2026-09-01T12:00:00Z',
    totalCents: 9900,
    receivedCents: 10000,
    changeCents: 100,
    customerName: null,
    tableNumber: null,
    waiterName: null,
    items: [{ id: 'i3', productId: 'p3', productName: 'Calzone', unitPriceCents: 9900, quantity: 1, returnedQuantity: 1 }],
  },
]

describe('ReturnsPage', () => {
  beforeEach(() => {
    vi.mocked(returnsRepository.listSessionSalesWithItems).mockResolvedValue(sales)
  })

  it('renders a card with customer, table, products, received and change', async () => {
    render(<ReturnsPage />)
    const card = (await screen.findByText('María López')).closest('article') as HTMLElement
    expect(card).not.toBeNull()
    const scope = within(card)
    expect(scope.getByText('Mesa 7')).toBeInTheDocument()
    expect(scope.getByText(/Carlos/)).toBeInTheDocument()
    expect(scope.getByText(/Folio aaaaaaaa/)).toBeInTheDocument()
    expect(scope.getByText(/2 × Pizza Hawaiana/)).toBeInTheDocument()
    expect(scope.getByText(/1 × Refresco/)).toBeInTheDocument()
    expect(scope.getByText(/1 devuelto/)).toBeInTheDocument()
    expect(scope.getByText(formatMoney(50000))).toBeInTheDocument()
    expect(scope.getByText(formatMoney(20000))).toBeInTheDocument()
    expect(scope.getAllByText(formatMoney(30000))).toHaveLength(2) // line amount + total
  })

  it('shows a fallback for POS sales and disables return when fully returned', async () => {
    render(<ReturnsPage />)
    const card = (await screen.findByText('Venta en mostrador')).closest('article') as HTMLElement
    expect(within(card).getByRole('button', { name: /devolver/i })).toBeDisabled()
  })

  it('filters by customer name and table number', async () => {
    const user = userEvent.setup()
    render(<ReturnsPage />)
    await screen.findByText('María López')

    await user.type(screen.getByLabelText('Buscar venta'), 'maría')
    expect(screen.getByText('María López')).toBeInTheDocument()
    expect(screen.queryByText('Venta en mostrador')).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Buscar venta'))
    await user.type(screen.getByLabelText('Buscar venta'), 'mesa 7')
    expect(screen.getByText('María López')).toBeInTheDocument()
    expect(screen.queryByText('Venta en mostrador')).not.toBeInTheDocument()
  })

  it('opens the return form from a card', async () => {
    const user = userEvent.setup()
    render(<ReturnsPage />)
    const card = (await screen.findByText('María López')).closest('article') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /devolver/i }))
    expect(screen.getByLabelText('Cantidad a devolver de Pizza Hawaiana')).toBeInTheDocument()
  })
})
