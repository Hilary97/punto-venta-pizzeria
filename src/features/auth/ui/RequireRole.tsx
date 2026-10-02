import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import type { UserRole } from '../../../shared/supabase/database.types'
import { useAuth } from './AuthContext'

interface RequireRoleProps {
  role: UserRole | UserRole[]
  children: ReactNode
}

/** Route guard: only renders children when the signed-in profile has one of the given roles; waiters are sent to /pedidos, others to /. */
export function RequireRole({ role, children }: RequireRoleProps) {
  const { profile } = useAuth()

  const allowed = Array.isArray(role) ? role : [role]

  if (!profile || !allowed.includes(profile.role)) {
    return <Navigate to={profile?.role === 'waiter' ? '/pedidos' : '/'} replace />
  }

  return <>{children}</>
}
