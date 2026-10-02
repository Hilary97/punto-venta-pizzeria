import { Button } from '../../../shared/ui/Button'
import type { AdminWaiter } from '../domain/waiter'

interface WaitersTableProps {
  waiters: AdminWaiter[]
  disabled: boolean
  onEdit: (waiter: AdminWaiter) => void
  onToggleActive: (waiter: AdminWaiter) => void
  onChangePin: (waiter: AdminWaiter) => void
  onUnlock: (waiter: AdminWaiter) => void
}

export function WaitersTable({ waiters, disabled, onEdit, onToggleActive, onChangePin, onUnlock }: WaitersTableProps) {
  if (waiters.length === 0) {
    return <p className="p-4 text-center text-slate-500">Aún no hay meseros registrados.</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            <th className="px-4 py-3 font-semibold">Mesero</th>
            <th className="px-4 py-3 font-semibold">Estado</th>
            <th className="px-4 py-3 font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {waiters.map((waiter) => (
            <tr key={waiter.id}>
              <td className="px-4 py-3 font-medium text-slate-900">{waiter.fullName}</td>
              <td className="px-4 py-3">
                <div className="flex gap-2">
                  <span
                    className={
                      waiter.active
                        ? 'rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800'
                        : 'rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-600'
                    }
                  >
                    {waiter.active ? 'Activo' : 'Inactivo'}
                  </span>
                  {waiter.locked && (
                    <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">
                      Bloqueado
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" disabled={disabled} onClick={() => onEdit(waiter)}>
                    Editar
                  </Button>
                  <Button variant="ghost" disabled={disabled} onClick={() => onToggleActive(waiter)}>
                    {waiter.active ? 'Desactivar' : 'Activar'}
                  </Button>
                  <Button variant="ghost" disabled={disabled} onClick={() => onChangePin(waiter)}>
                    Cambiar PIN
                  </Button>
                  {waiter.locked && (
                    <Button variant="ghost" disabled={disabled} onClick={() => onUnlock(waiter)}>
                      Desbloquear
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
