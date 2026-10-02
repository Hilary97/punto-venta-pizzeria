import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { expect, it, vi } from 'vitest'
import type { UserRole } from '../../../shared/supabase/database.types'
import { RequireRole } from './RequireRole'

const auth = vi.hoisted(() => ({ role: undefined as string | undefined }))
vi.mock('./AuthContext', () => ({
  useAuth: () => ({ profile: auth.role ? { fullName: 'Test', role: auth.role } : null }),
}))

function renderGuard(role: UserRole | UserRole[], current: UserRole | undefined) {
  auth.role = current
  render(
    <MemoryRouter initialEntries={['/secret']}>
      <Routes>
        <Route path="/" element={<p>home</p>} />
        <Route path="/pedidos" element={<p>orders</p>} />
        <Route path="/secret" element={<RequireRole role={role}><p>secret</p></RequireRole>} />
      </Routes>
    </MemoryRouter>,
  )
}

it('renders children for a matching single role', () => {
  renderGuard('admin', 'admin')
  expect(screen.getByText('secret')).toBeInTheDocument()
})

it('renders children when role is in the array', () => {
  renderGuard(['admin', 'cashier'], 'cashier')
  expect(screen.getByText('secret')).toBeInTheDocument()
})

it('redirects waiters to /pedidos when not allowed', () => {
  renderGuard(['admin', 'cashier'], 'waiter')
  expect(screen.getByText('orders')).toBeInTheDocument()
})

it('redirects a cashier to / on admin-only routes', () => {
  renderGuard('admin', 'cashier')
  expect(screen.getByText('home')).toBeInTheDocument()
})

it('redirects to / when there is no profile', () => {
  renderGuard('admin', undefined)
  expect(screen.getByText('home')).toBeInTheDocument()
})
