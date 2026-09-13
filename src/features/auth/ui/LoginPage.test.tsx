import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginPage } from './LoginPage'
import { useAuth } from './AuthContext'
import { signOut } from '../infrastructure/authRepository'

vi.mock('./AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../infrastructure/authRepository', () => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}))

const mockedUseAuth = vi.mocked(useAuth)
const mockedSignOut = vi.mocked(signOut)

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the context error message and a sign-out retry button when auth status is error', async () => {
    mockedUseAuth.mockReturnValue({
      status: 'error',
      profile: null,
      errorMessage:
        'Tu usuario no tiene un perfil registrado. Un administrador debe crearlo (consulta la sección de usuarios del README).',
    })

    render(<LoginPage />)

    expect(screen.getByText(/tu usuario no tiene un perfil registrado/i)).toBeInTheDocument()

    const retryButton = screen.getByRole('button', { name: /cerrar sesión e intentar de nuevo/i })
    const user = userEvent.setup()
    await user.click(retryButton)

    expect(mockedSignOut).toHaveBeenCalledTimes(1)
  })

  it('handles failed logout and allows retry without losing the profile error', async () => {
    mockedUseAuth.mockReturnValue({ status: 'error', profile: null, errorMessage: 'Error de perfil' })
    let reject!: (error: Error) => void
    mockedSignOut.mockReturnValueOnce(new Promise<void>((_, no) => { reject = no }))
    render(<LoginPage />)
    const user = userEvent.setup()
    const button = screen.getByRole('button')
    await user.click(button)
    expect(button).toBeDisabled()
    await user.click(button)
    expect(mockedSignOut).toHaveBeenCalledTimes(1)
    await act(async () => reject(new Error('No se pudo cerrar la sesión.')))
    expect(screen.getByText('No se pudo cerrar la sesión.')).toBeInTheDocument()
    expect(screen.getByText('Error de perfil')).toBeInTheDocument()
    expect(button).toBeEnabled()
    mockedSignOut.mockResolvedValueOnce(undefined)
    await user.click(button)
    expect(mockedSignOut).toHaveBeenCalledTimes(2)
  })

  it('does not show the retry banner when auth status is signed-out', () => {
    mockedUseAuth.mockReturnValue({ status: 'signed-out', profile: null, errorMessage: null })

    render(<LoginPage />)

    expect(
      screen.queryByRole('button', { name: /cerrar sesión e intentar de nuevo/i }),
    ).not.toBeInTheDocument()
  })
})
