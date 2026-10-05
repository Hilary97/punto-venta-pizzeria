import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toUserMessage } from '../../../shared/errors'
import type { DeliverySource } from '../../kitchen/domain/kitchen'
import { createDeviceDeliverySource } from '../../kitchen/infrastructure/kitchenRepository'
import { DeliveryBoard } from '../../kitchen/ui/DeliveryBoard'
import type { OrdersSource } from '../../orders/domain/ordersSource'
import { createDeviceOrdersSource } from '../../orders/infrastructure/ordersSources'
import { OrdersWorkspace } from '../../orders/ui/OrdersWorkspace'
import type { AuthorizedDevice } from '../domain/device'
import { clearDevice } from '../domain/deviceStorage'
import { clearShift, loadShift } from '../domain/shiftStorage'
import { cn } from '../../../shared/ui/cn'
import { createDeviceShiftApi, WaiterShiftGate, type ShiftApi } from './WaiterShiftGate'

type DeviceView = 'orders' | 'delivery'

const TABS: { value: DeviceView; label: string }[] = [
  { value: 'orders', label: 'Pedidos' },
  { value: 'delivery', label: 'Entrega' },
]

const REVOKED_MARKER = 'no está autorizado'

function isRevokedError(error: unknown): boolean {
  return toUserMessage(error).includes(REVOKED_MARKER)
}

/** Wraps an async call so a revoked-device error from the server is reported before it is rethrown. */
function revokedGuard(onRevoked: () => void) {
  return <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await call(...args)
      } catch (error) {
        if (isRevokedError(error)) onRevoked()
        throw error
      }
    }
}

/** Full-screen orders app for an authorized device: waiter gate and workspace, no app navigation. */
export function DeviceOrdersApp({ device }: { device: AuthorizedDevice }) {
  const [revoked, setRevoked] = useState(false)
  const [view, setView] = useState<DeviceView>('orders')

  const handleRevoked = useCallback(() => {
    clearDevice()
    clearShift()
    setRevoked(true)
  }, [])

  const api = useMemo<ShiftApi>(() => {
    const base = createDeviceShiftApi(device.secret)
    const guard = revokedGuard(handleRevoked)
    return {
      listWaiters: guard(base.listWaiters),
      startShift: guard(base.startShift),
      getShift: guard(base.getShift),
      endShift: guard(base.endShift),
    }
  }, [device.secret, handleRevoked])

  const source = useMemo<OrdersSource>(() => {
    const base = createDeviceOrdersSource(device.secret, () => loadShift()?.token ?? null)
    const guard = revokedGuard(handleRevoked)
    return {
      loadCatalog: guard(base.loadCatalog),
      listOpenOrders: guard(base.listOpenOrders),
      createOrder: guard(base.createOrder),
      addOrderItems: guard(base.addOrderItems),
      cancelOrder: guard(base.cancelOrder),
      setOrderNotes: guard(base.setOrderNotes),
    }
  }, [device.secret, handleRevoked])

  const deliverySource = useMemo<DeliverySource>(() => {
    const base = createDeviceDeliverySource(device.secret, () => loadShift()?.token ?? null)
    const guard = revokedGuard(handleRevoked)
    return {
      listReadyOrders: guard(base.listReadyOrders),
      markDelivered: guard(base.markDelivered),
    }
  }, [device.secret, handleRevoked])

  if (revoked) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
        <p className="max-w-md text-lg text-slate-800">
          Este dispositivo ya no está autorizado para pedidos. Pide a un administrador que lo autorice de nuevo.
        </p>
        <Link to="/login" className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white">
          Iniciar sesión
        </Link>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 shadow-sm">
        <h1 className="break-words text-lg font-bold text-slate-900">Pedidos · {device.name}</h1>
        <Link to="/login" className="shrink-0 text-sm text-slate-500 underline hover:text-slate-700">
          Administrador
        </Link>
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
                <DeliveryBoard source={deliverySource} />
              )}
            </div>
          )}
        </WaiterShiftGate>
      </main>
    </div>
  )
}
