import { useState } from 'react'
import { Navigate } from 'react-router'
import { AppLayout } from '../../../app/AppLayout'
import { useAuth } from '../../auth/ui/AuthContext'
import { RequireAuth } from '../../auth/ui/RequireAuth'
import { deviceKindStation } from '../../kitchen/domain/kitchen'
import { loadDevice } from '../../waiters/domain/deviceStorage'
import { DeviceOrdersApp } from '../../waiters/ui/DeviceOrdersApp'
import { OrdersPage } from './OrdersPage'

/** `/pedidos`: an authorized device needs no session; otherwise it is the signed-in experience. */
export function OrdersEntry() {
  const [device] = useState(() => loadDevice())

  if (device && deviceKindStation(device.kind) !== null) return <Navigate to="/cocina" replace />
  if (device) return <DeviceOrdersApp device={device} />

  return (
    <RequireAuth>
      <AppLayout>
        <SignedInOrders />
      </AppLayout>
    </RequireAuth>
  )
}

function SignedInOrders() {
  const { profile } = useAuth()

  if (profile?.role === 'waiter') {
    return (
      <p className="p-4 text-slate-700">
        Las cuentas de mesero ya no se usan. Pide a un administrador que autorice este dispositivo.
      </p>
    )
  }

  return <OrdersPage />
}
