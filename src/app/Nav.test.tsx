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

const openMore = async () => {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /^Más/ }))
  return user
}

it('shows only Pedidos to waiters', () => {
  auth.role = 'waiter'
  render(<MemoryRouter><Nav /></MemoryRouter>)
  expect(screen.getByRole('link', { name: 'Pedidos' })).toHaveAttribute('href', '/pedidos')
  for (const name of ['Venta', 'Cocina', 'Entrega', 'Historial de Ventas', 'Corte de caja', 'Productos', 'Inventario', 'Insumos', 'Pizzas', 'Historial de Cortes', 'Meseros'])
    expect(screen.queryByRole('link', { name })).not.toBeInTheDocument()
  auth.role = 'admin'
})

it('shows cash links plus Pedidos to cashiers, without admin links', async () => {
  auth.role = 'cashier'
  render(<MemoryRouter><Nav /></MemoryRouter>)
  await openMore()
  for (const name of ['Pedidos', 'Cocina', 'Entrega', 'Venta', 'Historial de Ventas', 'Corte de caja'])
    expect(screen.getByRole('link', { name })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Productos' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Inventario' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Insumos' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Meseros' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Pizzas' })).not.toBeInTheDocument()
  auth.role = 'admin'
})

it('offers the light/dark mode toggle', () => {
  render(<MemoryRouter><Nav /></MemoryRouter>)
  expect(screen.getByRole('button', { name: /Cambiar a modo (oscuro|claro)/ })).toBeVisible()
})

it('shows every link to admins', async () => {
  render(<MemoryRouter><Nav /></MemoryRouter>)
  await openMore()
  for (const name of ['Pedidos', 'Cocina', 'Entrega', 'Venta', 'Historial de Ventas', 'Corte de caja', 'Productos', 'Inventario', 'Insumos', 'Pizzas', 'Historial de Cortes', 'Meseros'])
    expect(screen.getByRole('link', { name })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Inventario' })).toHaveAttribute('href', '/admin/inventario')
  expect(screen.getByRole('link', { name: 'Insumos' })).toHaveAttribute('href', '/admin/insumos')
  expect(screen.getByRole('link', { name: 'Pizzas' })).toHaveAttribute('href', '/admin/pizzas')
})

it('keeps primary tabs visible and hides Caja/Admin links until Más is opened', async () => {
  render(<MemoryRouter><Nav /></MemoryRouter>)
  for (const name of ['Venta', 'Pedidos', 'Cocina', 'Entrega'])
    expect(screen.getByRole('link', { name })).toBeVisible()
  for (const name of ['Historial de Ventas', 'Corte de caja', 'Productos', 'Meseros'])
    expect(screen.queryByRole('link', { name })).not.toBeInTheDocument()
  const more = screen.getByRole('button', { name: /^Más/ })
  expect(more).toHaveAttribute('aria-expanded', 'false')
  await openMore()
  expect(more).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('link', { name: 'Corte de caja' })).toBeVisible()
})

it('groups Más links under Caja and Administración for admins', async () => {
  render(<MemoryRouter><Nav /></MemoryRouter>)
  await openMore()
  expect(screen.getByText('Caja')).toBeVisible()
  expect(screen.getByText('Administración')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Historial de Cortes' })).toHaveAttribute('href', '/admin/historial')
})

it('shows only the Caja group to non-admin, non-waiter users', async () => {
  auth.role = 'cashier'
  render(<MemoryRouter><Nav /></MemoryRouter>)
  await openMore()
  expect(screen.getByText('Caja')).toBeVisible()
  expect(screen.queryByText('Administración')).not.toBeInTheDocument()
  auth.role = 'admin'
})

it('closes Más with Escape and returns focus to its button', async () => {
  render(<MemoryRouter><Nav /></MemoryRouter>)
  const user = await openMore()
  await user.keyboard('{Escape}')
  const more = screen.getByRole('button', { name: /^Más/ })
  expect(more).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('link', { name: 'Corte de caja' })).not.toBeInTheDocument()
  expect(more).toHaveFocus()
})

it('closes Más on outside click and after choosing a link', async () => {
  render(<MemoryRouter><Nav /></MemoryRouter>)
  const user = await openMore()
  await user.click(document.body)
  expect(screen.queryByRole('link', { name: 'Corte de caja' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /^Más/ }))
  await user.click(screen.getByRole('link', { name: 'Corte de caja' }))
  expect(screen.queryByRole('link', { name: 'Corte de caja' })).not.toBeInTheDocument()
})

it('marks Más as current when the route is one of its links', () => {
  render(<MemoryRouter initialEntries={['/corte']}><Nav /></MemoryRouter>)
  expect(screen.getByRole('button', { name: /^Más/ })).toHaveAttribute('aria-current', 'true')
})

it('does not mark Más as current on a primary route', () => {
  render(<MemoryRouter initialEntries={['/pedidos']}><Nav /></MemoryRouter>)
  expect(screen.getByRole('button', { name: /^Más/ })).not.toHaveAttribute('aria-current')
})

it('gives waiters Pedidos as the only navigation link', () => {
  auth.role = 'waiter'
  render(<MemoryRouter><Nav /></MemoryRouter>)
  expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Pedidos'])
  expect(screen.getByRole('button', { name: 'Salir' })).toBeInTheDocument()
  auth.role = 'admin'
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
