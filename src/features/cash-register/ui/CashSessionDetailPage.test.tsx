import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as cashRegisterRepository from '../infrastructure/cashRegisterRepository'
import * as returnsRepository from '../../returns/infrastructure/returnsRepository'
import { CashSessionDetailPage } from './CashSessionDetailPage'

vi.mock('../infrastructure/cashRegisterRepository', () => ({
  getClosedSessionById: vi.fn(),
  getCashSummary: vi.fn(),
}))

vi.mock('../../returns/infrastructure/returnsRepository', () => ({
  listSessionSalesWithItems: vi.fn(),
  listSessionReturns: vi.fn(),
}))

const sessionId = '00000000-0000-4000-8000-000000000001'

const session = {
  id: sessionId,
  openedBy: 'admin',
  openedAt: '2026-09-01T12:00:00Z',
  openingCents: 50000,
  closedBy: 'admin',
  closedAt: '2026-09-01T20:00:00Z',
  countedCents: 150000,
  expectedCents: 150000,
  differenceCents: 0,
}

const cashSummary = {
  openingCents: 50000,
  salesTotalCents: 120000,
  returnsTotalCents: 20000,
  expectedCents: 150000,
  salesCount: 1,
  returnsCount: 1,
}

const sales = [
  {
    id: 'sale-1',
    createdAt: '2026-09-01T13:00:00Z',
    totalCents: 30000,
    receivedCents: 30000,
    changeCents: 0,
    items: [
      {
        id: 'item-1',
        productId: 'prod-1',
        productName: 'Pizza Hawaiana',
        unitPriceCents: 15000,
        quantity: 2,
        returnedQuantity: 1,
      },
    ],
  },
]

const returns = [
  {
    id: 'return-1',
    saleId: 'sale-1',
    cashierId: 'cashier-1',
    reason: 'Cliente insatisfecho',
    totalCents: 15000,
    createdAt: '2026-09-01T14:00:00Z',
    items: [{ id: 'ri-1', saleItemId: 'item-1', quantity: 1, amountCents: 15000 }],
  },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/admin/historial/${sessionId}`]}>
      <Routes>
        <Route path="/admin/historial/:sessionId" element={<CashSessionDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(cashRegisterRepository.getClosedSessionById).mockResolvedValue(session)
  vi.mocked(cashRegisterRepository.getCashSummary).mockResolvedValue(cashSummary)
  vi.mocked(returnsRepository.listSessionSalesWithItems).mockResolvedValue(sales)
  vi.mocked(returnsRepository.listSessionReturns).mockResolvedValue(returns)
})

describe('CashSessionDetailPage', () => {
  it('shows a loading state while fetching', () => {
    vi.mocked(cashRegisterRepository.getClosedSessionById).mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText(/cargando/i)).toBeInTheDocument()
  })

  it('shows an error banner when a fetch fails', async () => {
    vi.mocked(cashRegisterRepository.getCashSummary).mockRejectedValue(new Error('No se pudo calcular el resumen de caja.'))
    renderPage()
    expect(await screen.findByText('No se pudo calcular el resumen de caja.')).toBeInTheDocument()
  })

  it('renders the summary header, sales, products sold and returns tables', async () => {
    renderPage()

    expect(await screen.findByText('Corte de caja')).toBeInTheDocument()

    // Sales table
    const salesRow = screen.getByText(new Date(sales[0]!.createdAt).toLocaleString('es-MX')).closest('tr')
    expect(salesRow).not.toBeNull()

    // Products sold table (aggregated: 2 sold, 1 returned)
    expect(screen.getByText('Pizza Hawaiana')).toBeInTheDocument()
    const productsTable = screen.getByText('Pizza Hawaiana').closest('table')
    expect(productsTable).not.toBeNull()
    expect(productsTable).toHaveTextContent('2')
    expect(productsTable).toHaveTextContent('1')

    // Returns table
    expect(screen.getByText('Cliente insatisfecho')).toBeInTheDocument()
    const returnsTable = screen.getByText('Cliente insatisfecho').closest('table')
    expect(returnsTable).not.toBeNull()
    expect(returnsTable).toHaveTextContent('Pizza Hawaiana')

    expect(screen.getByRole('link', { name: /volver/i })).toHaveAttribute('href', '/admin/historial')
  })
})
