import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { Nav } from './Nav'

const logout = vi.hoisted(() => vi.fn())
vi.mock('../features/auth/infrastructure/authRepository', () => ({ signOut: logout }))
const auth = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'cashier' | 'waiter' }))
vi.mock('../features/auth/ui/AuthContext', () => ({
  useAuth: () => ({ profile: { fullName: 'Administrador', role: auth.role } }),
}))

it('shows only Pedidos to waiters', () => {
  auth.role = 'waiter'
  render(<MemoryRouter><Nav /></MemoryRouter>)
  expect(screen.getByRole('link', { name: 'Pedidos' })).toHaveAttribute('href', '/pedidos')
  for (const name of ['Venta', 'Cocina', 'Historial de Ventas', 'Corte de caja', 'Productos', 'Historial', 'Meseros'])
    expect(screen.queryByRole('link', { name })).not.toBeInTheDocument()
  auth.role = 'admin'
})

it('shows cash links plus Pedidos to cashiers, without admin links', () => {
  auth.role = 'cashier'
  render(<MemoryRouter><Nav /></MemoryRouter>)
  for (const name of ['Pedidos', 'Cocina', 'Venta', 'Historial de Ventas', 'Corte de caja'])
    expect(screen.getByRole('link', { name })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Productos' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Meseros' })).not.toBeInTheDocument()
  auth.role = 'admin'
})

it('shows every link to admins', () => {
  render(<MemoryRouter><Nav /></MemoryRouter>)
  for (const name of ['Pedidos', 'Cocina', 'Venta', 'Historial de Ventas', 'Corte de caja', 'Productos', 'Historial', 'Meseros'])
    expect(screen.getByRole('link', { name })).toBeInTheDocument()
})

it('disables pending logout, shows errors, preserves profile and permits retry', async () => {
  let reject!: (error: Error) => void
  logout.mockReturnValueOnce(new Promise<void>((_, no) => { reject = no }))
  render(<MemoryRouter><Nav /></MemoryRouter>)
  const user = userEvent.setup()
  const button = screen.getByRole('button', { name: 'Salir' })
  await user.click(button)
  expect(button).toBeDisabled()
  await user.click(button)
  expect(logout).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('No se pudo cerrar la sesión.')))
  expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cerrar la sesión.')
  expect(screen.getByText('Administrador')).toBeInTheDocument()
  expect(button).toBeEnabled()
  logout.mockResolvedValueOnce(undefined)
  await user.click(button)
  expect(logout).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
