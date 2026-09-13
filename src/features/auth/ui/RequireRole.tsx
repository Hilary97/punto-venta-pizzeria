import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import type { UserRole } from '../../../shared/supabase/database.types'
import { useAuth } from './AuthContext'

interface RequireRoleProps {
  role: UserRole
  children: ReactNode
}

/** Route guard: only renders children when the signed-in profile has the given role. */
export function RequireRole({ role, children }: RequireRoleProps) {
  const { profile } = useAuth()

  if (profile?.role !== role) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
