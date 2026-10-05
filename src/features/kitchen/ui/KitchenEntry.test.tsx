import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../../auth/ui/AuthContext'
import { saveDevice } from '../../waiters/domain/deviceStorage'
import { authenticatedKitchenSource, createDeviceKitchenSource } from '../infrastructure/kitchenRepository'
import { KitchenEntry } from './KitchenEntry'

vi.mock('../../auth/ui/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../auth/infrastructure/authRepository', () => ({ signOut: vi.fn() }))
vi.mock('../../cash-register/ui/CashSessionContext', () => ({
  CashSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('../infrastructure/kitchenRepository', () => ({
  createDeviceKitchenSource: vi.fn(),
  authenticatedKitchenSource: vi.fn(),
}))

function mockAuth(role: 'admin' | 'cashier' | 'waiter' | null) {
  vi.mocked(useAuth).mockReturnValue(
    (role
      ? { status: 'signed-in', profile: { id: 'u', fullName: 'Usuario', role }, errorMessage: null }
      : { status: 'signed-out', profile: null, errorMessage: null }) as ReturnType<typeof useAuth>,
  )
}

function source(orders: unknown[] = []) {
  return {
    listOrders: vi.fn().mockResolvedValue(orders),
    markReady: vi.fn().mockResolvedValue('o1'),
  }
}

function renderAt(path = '/cocina') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<p>Login page</p>} />
        <Route path="/" element={<p>Home page</p>} />
        <Route path="/pedidos" element={<p>Orders page</p>} />
        <Route path="/cocina" element={<KitchenEntry />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
})

describe('KitchenEntry', () => {
  it('opens a full-screen device app for a kitchen device without a session', async () => {
    saveDevice({ deviceId: 'd1', name: 'Tablet cocina', kind: 'kitchen_pizza', secret: 'b2'.repeat(32) })
    mockAuth(null)
    vi.mocked(createDeviceKitchenSource).mockReturnValue(source())
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Cocina · Tablet cocina · Pizzas' })).toBeVisible()
    expect(createDeviceKitchenSource).toHaveBeenCalledWith('b2'.repeat(32))
    expect(await screen.findByText('Sin pedidos en cocina')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Administrador' })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('link', { name: 'Venta' })).not.toBeInTheDocument()
  })

  it('labels the grill station', async () => {
    saveDevice({ deviceId: 'd1', name: 'Plancha', kind: 'kitchen_grill', secret: 'b2'.repeat(32) })
    mockAuth(null)
    vi.mocked(createDeviceKitchenSource).mockReturnValue(source())
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Cocina · Plancha · Hamburguesas y botanas' })).toBeVisible()
  })

  it('shows the revoked notice when the device is no longer authorized', async () => {
    saveDevice({ deviceId: 'd1', name: 'Tablet cocina', kind: 'kitchen_pizza', secret: 'b2'.repeat(32) })
    mockAuth(null)
    vi.mocked(createDeviceKitchenSource).mockReturnValue({
      listOrders: vi.fn().mockRejectedValue(new Error('Este dispositivo no está autorizado.')),
      markReady: vi.fn(),
    })
    renderAt()
    expect(await screen.findByText(/ya no está autorizado/)).toBeVisible()
    expect(localStorage.getItem('pizzeria.orderDevice')).toBeNull()
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/login')
  })

  it('shows station tabs with navigation to a cashier and switches station', async () => {
    mockAuth('cashier')
    vi.mocked(authenticatedKitchenSource).mockImplementation(() => source())
    renderAt()
    expect(await screen.findByRole('link', { name: 'Cocina' })).toBeVisible()
    expect(authenticatedKitchenSource).toHaveBeenCalledWith('pizza')
    const grill = screen.getByRole('tab', { name: 'Hamburguesas y botanas' })
    expect(screen.getByRole('tab', { name: 'Pizzas' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(grill)
    expect(grill).toHaveAttribute('aria-selected', 'true')
    expect(authenticatedKitchenSource).toHaveBeenCalledWith('grill')
  })

  it('redirects signed-out browsers without a device to login', async () => {
    mockAuth(null)
    renderAt()
    expect(await screen.findByText('Login page')).toBeVisible()
  })

  it('redirects waiters out of the page', async () => {
    mockAuth('waiter')
    renderAt()
    expect(await screen.findByText('Orders page')).toBeVisible()
  })
})
