import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { AuthorizedDevice } from '../../waiters/domain/device'
import { isRevokedDeviceError, reportingErrors } from '../../waiters/domain/deviceErrors'
import { clearDevice } from '../../waiters/domain/deviceStorage'
import { clearShift } from '../../waiters/domain/shiftStorage'
import { deviceKindStation, STATION_LABELS, type KitchenSource } from '../domain/kitchen'
import { createDeviceKitchenSource } from '../infrastructure/kitchenRepository'
import { RevokedDeviceScreen } from '../../waiters/ui/RevokedDeviceScreen'
import { KitchenBoard } from './KitchenBoard'

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
    const guard = reportingErrors(isRevokedDeviceError, handleRevoked)
    return { listOrders: guard(base.listOrders), markReady: guard(base.markReady), subscribe: base.subscribe }
  }, [device.secret, handleRevoked])

  if (revoked) return <RevokedDeviceScreen area="cocina" />

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
