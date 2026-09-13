import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { Nav } from './Nav'

const logout = vi.hoisted(() => vi.fn())
vi.mock('../features/auth/infrastructure/authRepository', () => ({ signOut: logout }))
vi.mock('../features/auth/ui/AuthContext', () => ({
  useAuth: () => ({ profile: { fullName: 'Administrador', role: 'admin' } }),
}))
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
