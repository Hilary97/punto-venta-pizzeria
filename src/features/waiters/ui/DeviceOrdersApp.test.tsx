import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrdersSource } from '../../orders/domain/ordersSource'
import { createDeviceDeliverySource } from '../../kitchen/infrastructure/kitchenRepository'
import { createDeviceOrdersSource } from '../../orders/infrastructure/ordersSources'
import { DEVICE_STORAGE_KEY, saveDevice } from '../domain/deviceStorage'
import type { AuthorizedDevice } from '../domain/device'
import { SHIFT_STORAGE_KEY } from '../domain/shiftStorage'
import type { WaiterShift } from '../domain/waiter'
import {
  deviceEndShift,
  deviceGetShift,
  deviceListWaiters,
  deviceStartShift,
} from '../infrastructure/waitersRepository'
import { DeviceOrdersApp } from './DeviceOrdersApp'

vi.mock('../infrastructure/waitersRepository', () => ({
  deviceListWaiters: vi.fn(),
  deviceStartShift: vi.fn(),
  deviceGetShift: vi.fn(),
  deviceEndShift: vi.fn(),
}))
vi.mock('../../orders/infrastructure/ordersSources', () => ({ createDeviceOrdersSource: vi.fn() }))

vi.mock('../../kitchen/infrastructure/kitchenRepository', () => ({ createDeviceDeliverySource: vi.fn() }))

const device: AuthorizedDevice = { deviceId: 'd1', name: 'Tablet barra', kind: 'waiter', secret: 'a1'.repeat(32) }

const shift: WaiterShift = {
  token: 'tok-1',
  waiterId: 'w1',
  fullName: 'Carlos',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
}

let source: OrdersSource

function renderApp() {
  return render(
    <MemoryRouter>
      <DeviceOrdersApp device={device} />
    </MemoryRouter>,
  )
}

async function loginWithPin(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Carlos' }))
  for (const digit of '1234') await user.click(screen.getByRole('button', { name: digit }))
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  saveDevice(device)
  source = {
    loadCatalog: vi.fn().mockResolvedValue({
      categories: [{ id: 'pizza', name: 'Botanas', sortOrder: 0 }],
      products: [{ id: 'p', categoryId: 'pizza', name: 'Pizza queso', priceCents: 0, active: true, variants: [] }],
      pizza: { sizes: [], styles: [], ingredients: [] },
    }),
    listOpenOrders: vi.fn().mockResolvedValue([]),
    createOrder: vi.fn().mockResolvedValue('new-order'),
    addOrderItems: vi.fn().mockResolvedValue('o'),
    cancelOrder: vi.fn().mockResolvedValue('o'),
    setOrderNotes: vi.fn().mockResolvedValue('o'),
  }
  vi.mocked(createDeviceOrdersSource).mockReturnValue(source)
  vi.mocked(createDeviceDeliverySource).mockReturnValue({
    listReadyOrders: vi.fn().mockResolvedValue([
      { id: 'r1', tableNumber: 7, customerName: null, waiterName: 'Carlos', notes: null, createdAt: '2026-01-01T15:05:00Z', lines: [] },
    ]),
    markDelivered: vi.fn().mockResolvedValue('r1'),
  })
  vi.mocked(deviceListWaiters).mockResolvedValue([{ id: 'w1', fullName: 'Carlos' }])
  vi.mocked(deviceStartShift).mockResolvedValue(shift)
  vi.mocked(deviceGetShift).mockResolvedValue(shift)
  vi.mocked(deviceEndShift).mockResolvedValue(undefined)
})

describe('DeviceOrdersApp', () => {
  it('shows the device name, no app navigation and only an admin login link', async () => {
    renderApp()
    expect(await screen.findByText('Pedidos · Tablet barra')).toBeVisible()
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Administrador' })).toHaveAttribute('href', '/login')
    expect(screen.queryByText(/venta|corte/i)).not.toBeInTheDocument()
  })

  it('lists the waiters with the stored device secret', async () => {
    renderApp()
    expect(await screen.findByRole('button', { name: 'Carlos' })).toBeVisible()
    expect(deviceListWaiters).toHaveBeenCalledWith(device.secret)
  })

  it('creates orders through the device source with the shift token and no charging', async () => {
    const user = userEvent.setup()
    renderApp()
    await loginWithPin(user)
    expect(deviceStartShift).toHaveBeenCalledWith(device.secret, 'w1', '1234')
    expect(createDeviceOrdersSource).toHaveBeenCalledWith(device.secret, expect.any(Function))
    const getToken = vi.mocked(createDeviceOrdersSource).mock.calls[0]![1]
    expect(getToken()).toBe('tok-1')

    await user.click(await screen.findByRole('button', { name: 'M-4' }))
    await user.click(screen.getByRole('button', { name: 'Botanas' }))
    await user.click(screen.getByRole('button', { name: /pizza queso/i }))
    await user.click(screen.getByRole('button', { name: /registrar pedido/i }))
    expect(source.createOrder).toHaveBeenCalledWith(4, null, [{ type: 'product', productId: 'p', quantity: 1 }], null)
    expect(screen.queryByRole('link', { name: /cobrar/i })).not.toBeInTheDocument()
  })

  it('clears the device and shows the revoked message when the server rejects it', async () => {
    vi.mocked(deviceListWaiters).mockRejectedValue(new Error('Este dispositivo no está autorizado.'))
    renderApp()
    expect(await screen.findByText(/ya no está autorizado para pedidos/i)).toBeVisible()
    expect(screen.getByRole('link', { name: /iniciar sesión/i })).toHaveAttribute('href', '/login')
    await waitFor(() => expect(localStorage.getItem(DEVICE_STORAGE_KEY)).toBeNull())
    expect(localStorage.getItem(SHIFT_STORAGE_KEY)).toBeNull()
  })

  it('also detects a revoked device from workspace calls', async () => {
    vi.mocked(source.listOpenOrders).mockRejectedValue(new Error('Este dispositivo no está autorizado.'))
    const user = userEvent.setup()
    renderApp()
    await loginWithPin(user)
    expect(await screen.findByText(/ya no está autorizado para pedidos/i)).toBeVisible()
    expect(localStorage.getItem(DEVICE_STORAGE_KEY)).toBeNull()
  })

  it('returns to the waiter list when the server says the shift expired', async () => {
    vi.mocked(source.createOrder).mockRejectedValueOnce(new Error('Tu turno expiró. Ingresa tu PIN de nuevo.'))
    const user = userEvent.setup()
    renderApp()
    await loginWithPin(user)
    await user.click(await screen.findByRole('button', { name: 'M-1' }))
    await user.click(screen.getByRole('button', { name: 'Botanas' }))
    await user.click(screen.getByRole('button', { name: /pizza queso/i }))
    await user.click(screen.getByRole('button', { name: /registrar pedido/i }))
    expect(await screen.findByText('¿Quién está tomando pedidos?')).toBeVisible()
    expect(localStorage.getItem(SHIFT_STORAGE_KEY)).toBeNull()
  })

  it('ends the shift with Cambiar mesero', async () => {
    const user = userEvent.setup()
    renderApp()
    await loginWithPin(user)
    await user.click(await screen.findByRole('button', { name: /cambiar mesero/i }))
    expect(deviceEndShift).toHaveBeenCalledWith(device.secret, 'tok-1')
    expect(await screen.findByText('¿Quién está tomando pedidos?')).toBeVisible()
  })

  it('switches between Pedidos and Entrega tabs once a shift is active', async () => {
    const user = userEvent.setup()
    renderApp()
    expect(screen.queryByRole('tab', { name: /entrega/i })).not.toBeInTheDocument()
    await loginWithPin(user)
    expect(await screen.findByRole('tab', { name: 'Pedidos' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: /entrega/i }))
    expect(await screen.findByText('M-7')).toBeVisible()
    expect(createDeviceDeliverySource).toHaveBeenCalledWith(device.secret, expect.any(Function))
    const getToken = vi.mocked(createDeviceDeliverySource).mock.calls[0]![1]
    expect(getToken()).toBe('tok-1')
    await user.click(screen.getByRole('tab', { name: 'Pedidos' }))
    expect(await screen.findByRole('button', { name: 'M-4' })).toBeVisible()
  })

  it('detects a revoked device from delivery calls', async () => {
    vi.mocked(createDeviceDeliverySource).mockReturnValue({
      listReadyOrders: vi.fn().mockRejectedValue(new Error('Este dispositivo no está autorizado.')),
      markDelivered: vi.fn(),
    })
    const user = userEvent.setup()
    renderApp()
    await loginWithPin(user)
    await user.click(await screen.findByRole('tab', { name: /entrega/i }))
    expect(await screen.findByText(/ya no está autorizado para pedidos/i)).toBeVisible()
  })
})
