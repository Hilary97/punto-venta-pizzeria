import { useMemo, useState } from 'react'
import { cn } from '../../../shared/ui/cn'
import { useAuth } from '../../auth/ui/AuthContext'
import { KITCHEN_STATIONS, STATION_LABELS, type KitchenStation } from '../domain/kitchen'
import { authenticatedKitchenSource } from '../infrastructure/kitchenRepository'
import { KitchenBoard } from './KitchenBoard'
import { KitchenSwitch } from './KitchenSwitch'

/** Admin/cashier kitchen view: one board per station, switched with tabs. */
export function KitchenPage() {
  const { profile } = useAuth()
  const [station, setStation] = useState<KitchenStation>('pizza')
  const source = useMemo(() => authenticatedKitchenSource(station), [station])

  return (
    <div className="flex flex-col">
      <KitchenSwitch canEdit={profile?.role === 'admin'} />
      <div role="tablist" aria-label="Estación de cocina" className="flex gap-2 px-4 pt-4">
        {KITCHEN_STATIONS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={station === value}
            onClick={() => setStation(value)}
            className={cn(
              'rounded-xl px-5 py-3 text-base font-semibold transition-colors',
              station === value ? 'bg-red-700 text-white' : 'bg-slate-200 text-slate-800 hover:bg-slate-300',
            )}
          >
            {STATION_LABELS[value]}
          </button>
        ))}
      </div>
      <KitchenBoard key={station} source={source} stationLabel={STATION_LABELS[station]} />
    </div>
  )
}
