import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toUserMessage } from '../../../shared/errors'
import type { AuthorizedDevice } from '../../waiters/domain/device'
import { clearDevice } from '../../waiters/domain/deviceStorage'
import { clearShift } from '../../waiters/domain/shiftStorage'
import { deviceKindStation, STATION_LABELS, type KitchenSource } from '../domain/kitchen'
import { createDeviceKitchenSource } from '../infrastructure/kitchenRepository'
import { KitchenBoard } from './KitchenBoard'

const REVOKED_MARKER = 'no está autorizado'

/** Full-screen kitchen app for an authorized kitchen device: no session, no app navigation. */
export function KitchenDeviceApp({ device }: { device: AuthorizedDevice }) {
  const [revoked, setRevoked] = useState(false)
  const station = deviceKindStation(device.kind)

  const handleRevoked = useCallback(() => {
    clearDevice()
    clearShift()
    setRevoked(true)
  }, [])

  const source = useMemo<KitchenSource>(() => {
    const base = createDeviceKitchenSource(device.secret)
    function guard<A extends unknown[], R>(call: (...args: A) => Promise<R>) {
      return async (...args: A): Promise<R> => {
        try {
          return await call(...args)
        } catch (error) {
          if (toUserMessage(error).includes(REVOKED_MARKER)) handleRevoked()
          throw error
        }
      }
    }
    return { listOrders: guard(base.listOrders), markReady: guard(base.markReady) }
  }, [device.secret, handleRevoked])

  if (revoked) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
        <p className="max-w-md text-lg text-slate-800">
          Este dispositivo ya no está autorizado para cocina. Pide a un administrador que lo autorice de nuevo.
        </p>
        <Link to="/login" className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white">
          Iniciar sesión
        </Link>
      </div>
    )
  }

  const stationLabel = station ? STATION_LABELS[station] : ''

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 shadow-sm">
        <h1 className="break-words text-lg font-bold text-slate-900">
          Cocina · {device.name} · {stationLabel}
        </h1>
        <Link to="/login" className="shrink-0 text-sm text-slate-500 underline hover:text-slate-700">
          Administrador
        </Link>
      </header>
      <main className="flex-1">
        <KitchenBoard source={source} stationLabel={stationLabel} />
      </main>
    </div>
  )
}
