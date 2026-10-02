import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AdminWaiter } from '../domain/waiter'
import { AdminWaitersPage } from './AdminWaitersPage'

const repo = vi.hoisted(() => ({
  adminListWaiters: vi.fn(),
  adminCreateWaiter: vi.fn(),
  adminUpdateWaiter: vi.fn(),
  adminResetWaiterPin: vi.fn(),
  adminUnlockWaiter: vi.fn(),
  adminDeleteWaiter: vi.fn(),
  adminDeleteDevice: vi.fn(),
  adminListDevices: vi.fn(),
  adminRegisterDevice: vi.fn(),
  adminRevokeDevice: vi.fn(),
}))
vi.mock('../../auth/infrastructure/authRepository', () => ({ signOut: vi.fn() }))
vi.mock('../infrastructure/waitersRepository', () => repo)

const WAITERS: AdminWaiter[] = [
  { id: 'w1', fullName: 'Ana Pérez', active: true, locked: false, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'w2', fullName: 'Luis Gómez', active: false, locked: true, createdAt: '2026-01-02T00:00:00Z' },
]

beforeEach(() => {
  vi.clearAllMocks()
  repo.adminListWaiters.mockResolvedValue(WAITERS)
  repo.adminCreateWaiter.mockResolvedValue(undefined)
  repo.adminUpdateWaiter.mockResolvedValue(undefined)
  repo.adminResetWaiterPin.mockResolvedValue(undefined)
  repo.adminUnlockWaiter.mockResolvedValue(undefined)
  repo.adminDeleteWaiter.mockResolvedValue(undefined)
  repo.adminDeleteDevice.mockResolvedValue(undefined)
  repo.adminListDevices.mockResolvedValue([])
})

async function renderPage() {
  render(
    <MemoryRouter>
      <AdminWaitersPage />
    </MemoryRouter>,
  )
  await screen.findByText('Ana Pérez')
  return userEvent.setup()
}

const row = (name: string) => screen.getByRole('row', { name: new RegExp(name) })

it('lists waiters with state and a Bloqueado badge only when locked', async () => {
  await renderPage()
  expect(within(row('Ana Pérez')).getByText('Activo')).toBeInTheDocument()
  expect(within(row('Ana Pérez')).queryByText('Bloqueado')).not.toBeInTheDocument()
  expect(within(row('Luis Gómez')).getByText('Inactivo')).toBeInTheDocument()
  expect(within(row('Luis Gómez')).getByText('Bloqueado')).toBeInTheDocument()
  expect(screen.getByText(/Cada mesero elige su nombre e ingresa su PIN/)).toBeInTheDocument()
})

it('offers Desbloquear only for locked waiters and unlocks them', async () => {
  const user = await renderPage()
  expect(within(row('Ana Pérez')).queryByRole('button', { name: 'Desbloquear' })).not.toBeInTheDocument()
  await user.click(within(row('Luis Gómez')).getByRole('button', { name: 'Desbloquear' }))
  expect(repo.adminUnlockWaiter).toHaveBeenCalledWith('w2')
  expect(repo.adminListWaiters).toHaveBeenCalledTimes(2)
})

it('rejects invalid PIN length and mismatched confirmation without calling the repository', async () => {
  const user = await renderPage()
  await user.click(screen.getByRole('button', { name: 'Nuevo mesero' }))
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText('Nombre'), 'Marta')
  const pin = within(dialog).getByLabelText('PIN')
  const confirm = within(dialog).getByLabelText('Confirmar PIN')
  expect(pin).toHaveAttribute('type', 'password')
  expect(pin).toHaveAttribute('inputmode', 'numeric')
  expect(pin).toHaveAttribute('maxlength', '4')
  expect(pin).toHaveAttribute('autocomplete', 'off')

  await user.type(pin, '12')
  await user.type(confirm, '12')
  await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
  expect(within(dialog).getByRole('alert')).toHaveTextContent('4 dígitos')

  await user.clear(pin)
  await user.clear(confirm)
  await user.type(pin, '1234')
  await user.type(confirm, '4321')
  await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
  expect(within(dialog).getByRole('alert')).toHaveTextContent('no coinciden')
  expect(repo.adminCreateWaiter).not.toHaveBeenCalled()
  expect(screen.queryByText('1234')).not.toBeInTheDocument()
})

it('creates a waiter with the normalized name and PIN, then reloads', async () => {
  const user = await renderPage()
  await user.click(screen.getByRole('button', { name: 'Nuevo mesero' }))
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText('Nombre'), '  Marta   Ruiz ')
  await user.type(within(dialog).getByLabelText('PIN'), '1234')
  await user.type(within(dialog).getByLabelText('Confirmar PIN'), '1234')
  await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
  expect(repo.adminCreateWaiter).toHaveBeenCalledWith('Marta Ruiz', '1234')
  expect(await screen.findByRole('status')).toHaveTextContent('Mesero creado')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(repo.adminListWaiters).toHaveBeenCalledTimes(2)
})

it('shows the repository error inside the create modal', async () => {
  repo.adminCreateWaiter.mockRejectedValueOnce(new Error('Ya existe un mesero con ese nombre.'))
  const user = await renderPage()
  await user.click(screen.getByRole('button', { name: 'Nuevo mesero' }))
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText('Nombre'), 'Ana Pérez')
  await user.type(within(dialog).getByLabelText('PIN'), '1234')
  await user.type(within(dialog).getByLabelText('Confirmar PIN'), '1234')
  await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ya existe un mesero')
})

it('toggles active state via adminUpdateWaiter keeping the name', async () => {
  const user = await renderPage()
  await user.click(within(row('Ana Pérez')).getByRole('button', { name: 'Desactivar' }))
  expect(repo.adminUpdateWaiter).toHaveBeenCalledWith('w1', 'Ana Pérez', false)
  await user.click(within(row('Luis Gómez')).getByRole('button', { name: 'Activar' }))
  expect(repo.adminUpdateWaiter).toHaveBeenCalledWith('w2', 'Luis Gómez', true)
})

it('renames a waiter keeping its active state', async () => {
  const user = await renderPage()
  await user.click(within(row('Ana Pérez')).getByRole('button', { name: 'Editar' }))
  const dialog = screen.getByRole('dialog')
  const name = within(dialog).getByLabelText('Nombre')
  await user.clear(name)
  await user.type(name, 'Ana María')
  await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
  expect(repo.adminUpdateWaiter).toHaveBeenCalledWith('w1', 'Ana María', true)
})

it('resets a PIN after validating the confirmation', async () => {
  const user = await renderPage()
  await user.click(within(row('Ana Pérez')).getByRole('button', { name: 'Cambiar PIN' }))
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText('Nuevo PIN'), '9999')
  await user.type(within(dialog).getByLabelText('Confirmar PIN'), '9998')
  await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
  expect(repo.adminResetWaiterPin).not.toHaveBeenCalled()

  await user.clear(within(dialog).getByLabelText('Confirmar PIN'))
  await user.type(within(dialog).getByLabelText('Confirmar PIN'), '9999')
  await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
  expect(repo.adminResetWaiterPin).toHaveBeenCalledWith('w1', '9999')
  expect(await screen.findByRole('status')).toHaveTextContent('PIN actualizado')
  expect(screen.queryByText('9999')).not.toBeInTheDocument()
})

it('opens a confirmation with the waiter name and does not delete on Cancelar', async () => {
  const user = await renderPage()
  await user.click(within(row('Ana Pérez')).getByRole('button', { name: 'Eliminar' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByRole('heading', { name: 'Eliminar mesero' })).toBeInTheDocument()
  expect(dialog).toHaveTextContent(
    'Se eliminará a Ana Pérez definitivamente y ya no podrá ingresar con su PIN. Los pedidos que registró conservan su nombre. Esta acción es irreversible.',
  )
  await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(repo.adminDeleteWaiter).not.toHaveBeenCalled()
})

it('offers Eliminar on every waiter row', async () => {
  await renderPage()
  expect(within(row('Ana Pérez')).getByRole('button', { name: 'Eliminar' })).toBeInTheDocument()
  expect(within(row('Luis Gómez')).getByRole('button', { name: 'Eliminar' })).toBeInTheDocument()
})

it('deletes a waiter after confirmation, reports success and reloads', async () => {
  const user = await renderPage()
  await user.click(within(row('Luis Gómez')).getByRole('button', { name: 'Eliminar' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar definitivamente' }))
  expect(repo.adminDeleteWaiter).toHaveBeenCalledTimes(1)
  expect(repo.adminDeleteWaiter).toHaveBeenCalledWith('w2')
  expect(await screen.findByRole('status')).toHaveTextContent('Mesero eliminado.')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(repo.adminListWaiters).toHaveBeenCalledTimes(2)
})

it('keeps the delete modal open and shows the server error', async () => {
  repo.adminDeleteWaiter.mockRejectedValueOnce(new Error('No se pudo eliminar el mesero.'))
  const user = await renderPage()
  await user.click(within(row('Ana Pérez')).getByRole('button', { name: 'Eliminar' }))
  const dialog = screen.getByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Eliminar definitivamente' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('No se pudo eliminar el mesero.')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(repo.adminListWaiters).toHaveBeenCalledTimes(1)
})
