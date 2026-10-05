import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { Spinner } from '../../../shared/ui/Spinner'
import { deviceKindStation } from '../../kitchen/domain/kitchen'
import { loadDevice } from '../../waiters/domain/deviceStorage'
import { signOut } from '../infrastructure/authRepository'
import { useAuth } from './AuthContext'
import { AuthErrorNotice } from './AuthErrorNotice'

/** Blocks rendering of protected routes until an authenticated session is confirmed. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, errorMessage } = useAuth()

  if (status === 'loading') {
    return <Spinner label="Verificando sesión…" className="min-h-dvh" />
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-md">
          <AuthErrorNotice
            message={errorMessage ?? 'Ocurrió un error inesperado.'}
            onSignOut={signOut}
          />
        </div>
      </div>
    )
  }

  if (status === 'signed-out') {
    // An authorized device works without a session, so it lands on its own screen instead of login.
    const device = loadDevice()
    if (!device) return <Navigate to="/login" replace />
    return <Navigate to={deviceKindStation(device.kind) ? '/cocina' : '/pedidos'} replace />
  }

  return <>{children}</>
}
