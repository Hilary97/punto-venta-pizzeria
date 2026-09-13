import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import { useCashSession } from './CashSessionContext'

/** Blocks a screen that requires an open cash session (Venta, Devoluciones, Corte). */
export function RequireOpenSession({ children }: { children: ReactNode }) {
  const { state } = useCashSession()

  if (state.status === 'loading') {
    return <Spinner label="Verificando estado de la caja…" />
  }

  if (state.status === 'error') {
    return (
      <div className="p-4">
        <ErrorBanner message={state.errorMessage ?? 'No se pudo verificar el estado de la caja.'} />
      </div>
    )
  }

  if (state.status === 'none') {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-lg font-medium text-slate-700">No hay una caja abierta en este momento.</p>
        <Link to="/abrir-caja" className="font-semibold text-red-700 underline">
          Abrir caja
        </Link>
      </div>
    )
  }

  return <>{children}</>
}
