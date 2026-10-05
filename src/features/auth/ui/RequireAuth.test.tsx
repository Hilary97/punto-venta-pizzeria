import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { saveDevice } from '../../waiters/domain/deviceStorage'
import { RequireAuth } from './RequireAuth'
import { useAuth } from './AuthContext'
import { signOut } from '../infrastructure/authRepository'

vi.mock('./AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../infrastructure/authRepository', () => ({
  signOut: vi.fn(),
}))

const mockedUseAuth = vi.mocked(useAuth)
const mockedSignOut = vi.mocked(signOut)

describe('RequireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  function renderSignedOutAtCash() {
    mockedUseAuth.mockReturnValue({ status: 'signed-out', profile: null, errorMessage: null })
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<RequireAuth>Protected content</RequireAuth>} />
          <Route path="/login" element={<p>Login page</p>} />
          <Route path="/pedidos" element={<p>Orders page</p>} />
          <Route path="/cocina" element={<p>Kitchen page</p>} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('sends a signed-out browser without an authorized device to login', () => {
    renderSignedOutAtCash()
    expect(screen.getByText('Login page')).toBeInTheDocument()
  })

  it('sends a signed-out authorized order device to orders instead of login', () => {
    saveDevice({ deviceId: 'device-1', name: 'Tablet barra', kind: 'waiter', secret: 'a'.repeat(64) })
    renderSignedOutAtCash()
    expect(screen.getByText('Orders page')).toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('sends a signed-out authorized kitchen device to the kitchen', () => {
    saveDevice({ deviceId: 'device-2', name: 'Cocina', kind: 'kitchen_grill', secret: 'a'.repeat(64) })
    renderSignedOutAtCash()
    expect(screen.getByText('Kitchen page')).toBeInTheDocument()
  })

  it('shows logout failures and permits retry on a protected route', async () => {
    mockedUseAuth.mockReturnValue({ status: 'error', profile: null, errorMessage: 'Error de perfil' })
    let reject!: (error: Error) => void
    mockedSignOut.mockReturnValueOnce(new Promise<void>((_, no) => { reject = no }))
    render(<MemoryRouter><RequireAuth>Protected content</RequireAuth></MemoryRouter>)
    const user = userEvent.setup()
    const button = screen.getByRole('button')
    await user.click(button)
    expect(button).toBeDisabled()
    await act(async () => reject(new Error('No se pudo cerrar la sesión.')))
    expect(screen.getByText('No se pudo cerrar la sesión.')).toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
    expect(button).toBeEnabled()
    mockedSignOut.mockResolvedValueOnce(undefined)
    await user.click(button)
    expect(mockedSignOut).toHaveBeenCalledTimes(2)
  })

  it('offers a sign-out retry button when auth status is error', async () => {
    mockedUseAuth.mockReturnValue({
      status: 'error',
      profile: null,
      errorMessage: 'No se pudo cargar el perfil del usuario: permission denied.',
    })

    render(
      <MemoryRouter>
        <RequireAuth>
          <div>Protected content</div>
        </RequireAuth>
      </MemoryRouter>,
    )

    expect(screen.getByText(/no se pudo cargar el perfil del usuario/i)).toBeInTheDocument()

    const retryButton = screen.getByRole('button', { name: /cerrar sesión e intentar de nuevo/i })
    const user = userEvent.setup()
    await user.click(retryButton)

    expect(mockedSignOut).toHaveBeenCalledTimes(1)
  })
})
