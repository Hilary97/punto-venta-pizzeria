import { ErrorBanner } from '../shared/ui/ErrorBanner'
import { Spinner } from '../shared/ui/Spinner'
import { useCashSession } from '../features/cash-register/ui/CashSessionContext'
import { OpenRegisterPage } from '../features/cash-register/ui/OpenRegisterPage'
import { PosPage } from '../features/sales/ui/PosPage'

/** Shows "Abrir caja" when no cash session is open, otherwise the POS sale screen. */
export function HomeRoute() {
  const { state } = useCashSession()

  if (state.status === 'loading') {
    return <Spinner label="Verificando estado de la caja…" className="min-h-[calc(100dvh-4rem)]" />
  }

  if (state.status === 'error') {
    return (
      <div className="p-4">
        <ErrorBanner message={state.errorMessage ?? 'No se pudo verificar el estado de la caja.'} />
      </div>
    )
  }

  if (state.status === 'none') {
    return <OpenRegisterPage />
  }

  return <PosPage />
}
