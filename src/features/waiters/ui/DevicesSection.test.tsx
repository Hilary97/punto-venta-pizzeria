import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AdminDevice, AuthorizedDevice } from '../domain/device'
import { clearDevice, loadDevice, saveDevice } from '../domain/deviceStorage'
import { SHIFT_STORAGE_KEY } from '../domain/shiftStorage'
import { DevicesSection } from './DevicesSection'

const repo = vi.hoisted(() => ({
  adminListDevices: vi.fn(),
  adminRegisterDevice: vi.fn(),
  adminRevokeDevice: vi.fn(),
}))
vi.mock('../infrastructure/waitersRepository', () => repo)

const auth = vi.hoisted(() => ({ signOut: vi.fn() }))
vi.mock('../../auth/infrastructure/authRepository', () => auth)

const SECRET = 'ab'.repeat(32)

const DEVICES: AdminDevice[] = [
  { id: 'd1', name: 'Tablet barra', createdAt: '2026-01-01T00:00:00Z', lastSeenAt: '2026-02-03T15:30:00Z', revoked: false },
  { id: 'd2', name: 'Celular viejo', createdAt: '2026-01-02T00:00:00Z', lastSeenAt: null, revoked: true },
]

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  repo.adminListDevices.mockResolvedValue(DEVICES)
  repo.adminRevokeDevice.mockResolvedValue(undefined)
  repo.adminRegisterDevice.mockResolvedValue({ deviceId: 'new-1', name: 'Tablet nueva', secret: SECRET })
  auth.signOut.mockResolvedValue(undefined)
})

async function renderSection() {
  render(
    <MemoryRouter initialEntries={['/admin/meseros']}>
      <Routes>
        <Route path="/admin/meseros" element={<DevicesSection />} />
        <Route path="/pedidos" element={<p>Pantalla de pedidos</p>} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByText('Tablet barra')
  return userEvent.setup()
}

const row = (name: string) => screen.getByRole('row', { name: new RegExp(name) })

it('lists devices with last use and state, and Revocar only on active ones', async () => {
  await renderSection()
  expect(screen.getByText(/Autoriza la tablet o celular de los meseros/)).toBeInTheDocument()
  expect(within(row('Tablet barra')).getByText('Activo')).toBeInTheDocument()
  expect(within(row('Tablet barra')).queryByText('Nunca')).not.toBeInTheDocument()
  expect(within(row('Tablet barra')).getByRole('button', { name: 'Revocar' })).toBeInTheDocument()
  expect(within(row('Celular viejo')).getByText('Revocado')).toBeInTheDocument()
  expect(within(row('Celular viejo')).getByText('Nunca')).toBeInTheDocument()
  expect(within(row('Celular viejo')).queryByRole('button', { name: 'Revocar' })).not.toBeInTheDocument()
})

it('revokes only after confirmation, then reloads', async () => {
  const user = await renderSection()
  await user.click(within(row('Tablet barra')).getByRole('button', { name: 'Revocar' }))
  const dialog = screen.getByRole('dialog')
  expect(dialog).toHaveTextContent('¿Revocar Tablet barra? Ese dispositivo dejará de poder registrar pedidos.')
  expect(repo.adminRevokeDevice).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'Revocar' }))
  await waitFor(() => expect(repo.adminRevokeDevice).toHaveBeenCalledWith('d1'))
  await waitFor(() => expect(repo.adminListDevices).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('authorizes this device: stores it, clears shift, signs out and goes to /pedidos without exposing the secret', async () => {
  localStorage.setItem(SHIFT_STORAGE_KEY, '{"stale":true}')
  const user = await renderSection()
  await user.click(screen.getByRole('button', { name: 'Usar este dispositivo para pedidos' }))
  const dialog = screen.getByRole('dialog')
  expect(dialog).toHaveTextContent(/se cerrará tu sesión/i)
  await user.type(within(dialog).getByLabelText('Nombre del dispositivo'), '  Tablet   nueva ')
  await user.click(within(dialog).getByRole('button', { name: 'Autorizar' }))

  expect(await screen.findByText('Pantalla de pedidos')).toBeInTheDocument()
  expect(repo.adminRegisterDevice).toHaveBeenCalledWith('Tablet nueva')
  expect(loadDevice()).toEqual({ deviceId: 'new-1', name: 'Tablet nueva', secret: SECRET })
  expect(localStorage.getItem(SHIFT_STORAGE_KEY)).toBeNull()
  expect(auth.signOut).toHaveBeenCalledTimes(1)
  expect(document.body.innerHTML).not.toContain(SECRET)
})

it('still goes to /pedidos when signOut fails after storing the device', async () => {
  auth.signOut.mockRejectedValueOnce(new Error('No se pudo cerrar la sesión.'))
  const user = await renderSection()
  await user.click(screen.getByRole('button', { name: 'Usar este dispositivo para pedidos' }))
  await user.type(screen.getByLabelText('Nombre del dispositivo'), 'Tablet nueva')
  await user.click(screen.getByRole('button', { name: 'Autorizar' }))
  expect(await screen.findByText('Pantalla de pedidos')).toBeInTheDocument()
  expect(loadDevice()?.deviceId).toBe('new-1')
})

it('blocks an empty or too long device name without calling the repository', async () => {
  const user = await renderSection()
  await user.click(screen.getByRole('button', { name: 'Usar este dispositivo para pedidos' }))
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText('Nombre del dispositivo'), '   ')
  await user.click(within(dialog).getByRole('button', { name: 'Autorizar' }))
  expect(within(dialog).getByRole('alert')).toHaveTextContent('entre 1 y 60')

  const input = within(dialog).getByLabelText('Nombre del dispositivo')
  await user.clear(input)
  await user.type(input, 'x'.repeat(61))
  await user.click(within(dialog).getByRole('button', { name: 'Autorizar' }))
  expect(within(dialog).getByRole('alert')).toHaveTextContent('entre 1 y 60')
  expect(repo.adminRegisterDevice).not.toHaveBeenCalled()
  expect(loadDevice()).toBeNull()
})

it('shows the registration error and does not store or sign out', async () => {
  repo.adminRegisterDevice.mockRejectedValueOnce(new Error('No se pudo autorizar el dispositivo.'))
  const user = await renderSection()
  await user.click(screen.getByRole('button', { name: 'Usar este dispositivo para pedidos' }))
  await user.type(screen.getByLabelText('Nombre del dispositivo'), 'Tablet nueva')
  await user.click(screen.getByRole('button', { name: 'Autorizar' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo autorizar')
  expect(loadDevice()).toBeNull()
  expect(auth.signOut).not.toHaveBeenCalled()
})

it('notes an already authorized browser and removes it locally without revoking', async () => {
  const device: AuthorizedDevice = { deviceId: 'd1', name: 'Tablet barra', secret: SECRET }
  saveDevice(device)
  localStorage.setItem(SHIFT_STORAGE_KEY, '{"stale":true}')
  const user = await renderSection()
  expect(screen.getByText(/Este navegador ya está autorizado como Tablet barra/)).toBeInTheDocument()
  expect(document.body.innerHTML).not.toContain(SECRET)
  await user.click(screen.getByRole('button', { name: 'Quitar autorización de este navegador' }))
  expect(loadDevice()).toBeNull()
  expect(localStorage.getItem(SHIFT_STORAGE_KEY)).toBeNull()
  expect(repo.adminRevokeDevice).not.toHaveBeenCalled()
  expect(screen.queryByText(/Este navegador ya está autorizado/)).not.toBeInTheDocument()
  clearDevice()
})
