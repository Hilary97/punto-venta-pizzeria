import { useAuth } from '../../auth/ui/AuthContext'
import { WaiterShiftGate } from '../../waiters/ui/WaiterShiftGate'
import { OrdersWorkspace } from './OrdersWorkspace'

/** Waiters pick their name and PIN first; admin and cashier go straight in. */
export function OrdersPage() {
  const { profile } = useAuth()

  if (profile?.role !== 'waiter') {
    return <OrdersWorkspace shift={null} canCharge onChangeWaiter={() => undefined} onShiftExpired={() => undefined} />
  }

  return (
    <WaiterShiftGate>
      {(shift, onChangeWaiter, onShiftExpired) => (
        <OrdersWorkspace shift={shift} canCharge={false} onChangeWaiter={onChangeWaiter} onShiftExpired={onShiftExpired} />
      )}
    </WaiterShiftGate>
  )
}
