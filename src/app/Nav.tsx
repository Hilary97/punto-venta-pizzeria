import { useState } from 'react'
import { ErrorBanner } from '../shared/ui/ErrorBanner'
import { toUserMessage } from '../shared/errors'
import { NavLink } from 'react-router'
import { cn } from '../shared/ui/cn'
import { signOut } from '../features/auth/infrastructure/authRepository'
import { useAuth } from '../features/auth/ui/AuthContext'

const NAV_LINK_CLASS = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors',
    isActive ? 'bg-red-700 text-white' : 'text-slate-700 hover:bg-slate-100',
  )

export function Nav() {
  const { profile } = useAuth()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSignOut() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await signOut()
    } catch (error) {
      setError(toUserMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <nav className="flex h-16 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 shadow-sm">
      <div className="flex items-center gap-1 overflow-x-auto">
        <NavLink to="/" end className={NAV_LINK_CLASS}>
          Venta
        </NavLink>
        <NavLink to="/devoluciones" className={NAV_LINK_CLASS}>
          Devoluciones
        </NavLink>
        <NavLink to="/corte" className={NAV_LINK_CLASS}>
          Corte de caja
        </NavLink>
        {profile?.role === 'admin' && (
          <>
            <NavLink to="/admin/productos" className={NAV_LINK_CLASS}>
              Productos
            </NavLink>
            <NavLink to="/admin/historial" className={NAV_LINK_CLASS}>
              Historial
            </NavLink>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        {profile && <span className="hidden text-sm text-slate-500 sm:inline">{profile.fullName}</span>}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={pending}
          className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100"
        >
          {pending ? 'Cerrando sesión…' : 'Salir'}
        </button>
        {error && <ErrorBanner message={error} />}
      </div>
    </nav>
  )
}
