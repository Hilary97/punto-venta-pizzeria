import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ThemeToggle } from '../../../shared/theme/ThemeToggle'
import type { DeliverySource } from '../../kitchen/domain/kitchen'
import { createDeviceDeliverySource } from '../../kitchen/infrastructure/kitchenRepository'
import { DeliveryBoard } from '../../kitchen/ui/DeliveryBoard'
import type { OrdersSource } from '../../orders/domain/ordersSource'
import { createDeviceOrdersSource } from '../../orders/infrastructure/ordersSources'
import { OrdersWorkspace } from '../../orders/ui/OrdersWorkspace'
import type { AuthorizedDevice } from '../domain/device'
import { isRevokedDeviceError, isShiftError, reportingErrors } from '../domain/deviceErrors'
import { clearDevice } from '../domain/deviceStorage'
import { clearShift, loadShift } from '../domain/shiftStorage'
import { cn } from '../../../shared/ui/cn'
import { RevokedDeviceScreen } from './RevokedDeviceScreen'
import { createDeviceShiftApi, WaiterShiftGate, type ShiftApi } from './WaiterShiftGate'

type DeviceView = 'orders' | 'delivery'

const TABS: { value: DeviceView; label: string }[] = [
  { value: 'orders', label: 'Pedidos' },
  { value: 'delivery', label: 'Entrega' },
]

/**
 * Delivery board whose calls drop the shift (back to the waiter list) once the server rejects it.
 * Both callbacks must be stable, or the source is rebuilt and the board restarts.
 */
function DeliveryTab({
  source,
  onShiftExpired,
  onLeave,
}: {
  source: DeliverySource
  onShiftExpired: () => void
  onLeave: () => void
}) {
  const guarded = useMemo<DeliverySource>(() => {
    const guard = reportingErrors(isShiftError, () => {
      onLeave()
      onShiftExpired()
    })
    return { ...source, listReadyOrders: guard(source.listReadyOrders), markDelivered: guard(source.markDelivered) }
  }, [source, onShiftExpired, onLeave])
  return <DeliveryBoard source={guarded} />
}

/** Full-screen orders app for an authorized device: waiter gate and workspace, no app navigation. */
export function DeviceOrdersApp({ device }: { device: AuthorizedDevice }) {
  const [revoked, setRevoked] = useState(false)
  const [view, setView] = useState<DeviceView>('orders')

  // The next waiter starts on Pedidos after a shift expires on Entrega.
  const showOrders = useCallback(() => setView('orders'), [])

  const handleRevoked = useCallback(() => {
    clearDevice()
    clearShift()
    setRevoked(true)
  }, [])

  const api = useMemo<ShiftApi>(() => {
    const base = createDeviceShiftApi(device.secret)
    const guard = reportingErrors(isRevokedDeviceError, handleRevoked)
    return {
      listWaiters: guard(base.listWaiters),
      startShift: guard(base.startShift),
      getShift: guard(base.getShift),
      endShift: guard(base.endShift),
    }
  }, [device.secret, handleRevoked])

  const source = useMemo<OrdersSource>(() => {
    const base = createDeviceOrdersSource(device.secret, () => loadShift()?.token ?? null)
    const guard = reportingErrors(isRevokedDeviceError, handleRevoked)
    return {
      loadCatalog: guard(base.loadCatalog),
      listOpenOrders: guard(base.listOpenOrders),
      createOrder: guard(base.createOrder),
      addOrderItems: guard(base.addOrderItems),
      cancelOrder: guard(base.cancelOrder),
      setOrderNotes: guard(base.setOrderNotes),
      subscribe: base.subscribe,
    }
  }, [device.secret, handleRevoked])

  const deliverySource = useMemo<DeliverySource>(() => {
    const base = createDeviceDeliverySource(device.secret, () => loadShift()?.token ?? null)
    const guard = reportingErrors(isRevokedDeviceError, handleRevoked)
    return {
      listReadyOrders: guard(base.listReadyOrders),
      markDelivered: guard(base.markDelivered),
      subscribe: base.subscribe,
    }
  }, [device.secret, handleRevoked])

  if (revoked) return <RevokedDeviceScreen area="pedidos" />

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 shadow-sm">
        <h1 className="break-words text-lg font-bold text-slate-900">Pedidos · {device.name}</h1>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <Link to="/login" className="text-sm text-slate-500 underline hover:text-slate-700">
            Administrador
          </Link>
        </div>
      </header>
      <main className="flex-1">
        <WaiterShiftGate api={api}>
          {(shift, onChangeWaiter, onShiftExpired) => (
            <div className="flex flex-col">
              <div role="tablist" aria-label="Sección" className="flex gap-2 px-4 pt-4">
                {TABS.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={view === tab.value}
                    onClick={() => setView(tab.value)}
                    className={cn(
                      'rounded-xl px-5 py-3 text-base font-semibold transition-colors',
                      view === tab.value ? 'bg-red-700 text-white' : 'bg-slate-200 text-slate-800 hover:bg-slate-300',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {view === 'orders' ? (
                <OrdersWorkspace
                  source={source}
                  shift={shift}
                  canCharge={false}
                  onChangeWaiter={onChangeWaiter}
                  onShiftExpired={onShiftExpired}
                />
              ) : (
                <DeliveryTab source={deliverySource} onShiftExpired={onShiftExpired} onLeave={showOrders} />
              )}
            </div>
          )}
        </WaiterShiftGate>
      </main>
    </div>
  )
}
