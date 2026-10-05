import { useState } from 'react'
import { AppLayout } from '../../../app/AppLayout'
import { RequireAuth } from '../../auth/ui/RequireAuth'
import { RequireRole } from '../../auth/ui/RequireRole'
import { loadDevice } from '../../waiters/domain/deviceStorage'
import { deviceKindStation } from '../domain/kitchen'
import { KitchenDeviceApp } from './KitchenDeviceApp'
import { KitchenPage } from './KitchenPage'

/** `/cocina`: an authorized kitchen device needs no session; otherwise admin/cashier see both stations. */
export function KitchenEntry() {
  const [device] = useState(() => loadDevice())

  if (device && deviceKindStation(device.kind) !== null) return <KitchenDeviceApp device={device} />

  return (
    <RequireAuth>
      <AppLayout>
        <RequireRole role={['admin', 'cashier']}>
          <KitchenPage />
        </RequireRole>
      </AppLayout>
    </RequireAuth>
  )
}
