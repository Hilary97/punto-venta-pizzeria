import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../../auth/ui/AuthContext'
import { RequireAuth } from '../../auth/ui/RequireAuth'
import { listPizzaCatalog } from '../../pizza/infrastructure/pizzaRepository'
import { listCategories, listProducts } from '../../products/infrastructure/productsRepository'
import { saveDevice } from '../../waiters/domain/deviceStorage'
import { deviceListWaiters } from '../../waiters/infrastructure/waitersRepository'
import { listOpenOrders } from '../infrastructure/ordersRepository'
import { OrdersEntry } from './OrdersEntry'

vi.mock('../../auth/ui/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../auth/infrastructure/authRepository', () => ({ signOut: vi.fn() }))
vi.mock('../../pizza/infrastructure/pizzaRepository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../pizza/infrastructure/pizzaRepository')>()),
  listPizzaCatalog: vi.fn(),
}))
vi.mock('../../products/infrastructure/productsRepository', () => ({ listCategories: vi.fn(), listProducts: vi.fn() }))
vi.mock('../infrastructure/ordersRepository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../infrastructure/ordersRepository')>()),
  listOpenOrders: vi.fn(),
  createOrder: vi.fn(),
  addOrderItems: vi.fn(),
  cancelOrder: vi.fn(),
}))
vi.mock('../../waiters/infrastructure/waitersRepository', () => ({
  deviceListWaiters: vi.fn(),
  deviceStartShift: vi.fn(),
  deviceGetShift: vi.fn(),
  deviceEndShift: vi.fn(),
}))
vi.mock('../../cash-register/ui/CashSessionContext', () => ({
  CashSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

function mockAuth(role: 'admin' | 'cashier' | 'waiter' | null) {
  vi.mocked(useAuth).mockReturnValue(
    (role
      ? { status: 'signed-in', profile: { id: 'u', fullName: 'Usuario', role }, errorMessage: null }
      : { status: 'signed-out', profile: null, errorMessage: null }) as ReturnType<typeof useAuth>,
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<p>Login page</p>} />
        <Route path="/pedidos" element={<OrdersEntry />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <p>Cash screen</p>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.mocked(listPizzaCatalog).mockResolvedValue({ sizes: [], styles: [], ingredients: [] })
  vi.mocked(listCategories).mockResolvedValue([{ id: 'pizza', name: 'Botanas', sortOrder: 0 }])
  vi.mocked(listProducts).mockResolvedValue([])
  vi.mocked(listOpenOrders).mockResolvedValue([])
  vi.mocked(deviceListWaiters).mockResolvedValue([{ id: 'w1', fullName: 'Carlos' }])
})

describe('OrdersEntry', () => {
  it('opens the device app without any session when a device is stored', async () => {
    saveDevice({ deviceId: 'd1', name: 'Tablet barra', secret: 'a1'.repeat(32) })
    mockAuth(null)
    renderAt('/pedidos')
    expect(await screen.findByText('Pedidos · Tablet barra')).toBeVisible()
    expect(await screen.findByRole('button', { name: 'Carlos' })).toBeVisible()
    expect(screen.queryByText('Login page')).not.toBeInTheDocument()
  })

  it('shows the authenticated orders page with navigation for a cashier without a device', async () => {
    mockAuth('cashier')
    renderAt('/pedidos')
    expect(await screen.findByRole('heading', { name: /pedidos abiertos/i })).toBeVisible()
    expect(screen.getByRole('link', { name: /venta/i })).toBeVisible()
    expect(deviceListWaiters).not.toHaveBeenCalled()
  })

  it('redirects to /login when signed out and no device is stored', async () => {
    mockAuth(null)
    renderAt('/pedidos')
    expect(await screen.findByText('Login page')).toBeVisible()
  })

  it('tells legacy waiter accounts to authorize the device', async () => {
    mockAuth('waiter')
    renderAt('/pedidos')
    expect(
      await screen.findByText(
        'Las cuentas de mesero ya no se usan. Pide a un administrador que autorice este dispositivo.',
      ),
    ).toBeVisible()
  })

  it('sends an authorized device without a session from the cash screens to orders', async () => {
    saveDevice({ deviceId: 'd1', name: 'Tablet barra', secret: 'a1'.repeat(32) })
    mockAuth(null)
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Pedidos · Tablet barra' })).toBeVisible()
    expect(screen.queryByText('Login page')).not.toBeInTheDocument()
    expect(screen.queryByText('Cash screen')).not.toBeInTheDocument()
  })
})
