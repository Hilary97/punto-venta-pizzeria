import { useEffect, useState } from 'react'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { MoneyText } from '../../../shared/ui/MoneyText'
import { Spinner } from '../../../shared/ui/Spinner'
import { toUserMessage } from '../../../shared/errors'
import type { CashSession } from '../domain/cashSession'
import { listPastSessions } from '../infrastructure/cashRegisterRepository'

export function CashHistoryPage() {
  const [sessions, setSessions] = useState<CashSession[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        setSessions(await listPastSessions())
      } catch (error) {
        setErrorMessage(toUserMessage(error))
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [])

  if (isLoading) {
    return <Spinner label="Cargando historial…" />
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-slate-900">Historial de cortes</h1>

      {errorMessage && <ErrorBanner message={errorMessage} />}

      {sessions.length === 0 ? (
        <p className="text-slate-500">Aún no hay cortes de caja registrados.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Abierta</th>
                <th className="px-4 py-3 font-semibold">Cerrada</th>
                <th className="px-4 py-3 font-semibold">Fondo</th>
                <th className="px-4 py-3 font-semibold">Esperado</th>
                <th className="px-4 py-3 font-semibold">Contado</th>
                <th className="px-4 py-3 font-semibold">Diferencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td className="px-4 py-3">{new Date(session.openedAt).toLocaleString('es-MX')}</td>
                  <td className="px-4 py-3">
                    {session.closedAt ? new Date(session.closedAt).toLocaleString('es-MX') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <MoneyText cents={session.openingCents} />
                  </td>
                  <td className="px-4 py-3">
                    {session.expectedCents !== null ? <MoneyText cents={session.expectedCents} /> : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {session.countedCents !== null ? <MoneyText cents={session.countedCents} /> : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {session.differenceCents !== null ? (
                      <span className={session.differenceCents < 0 ? 'text-red-700' : 'text-emerald-700'}>
                        <MoneyText cents={session.differenceCents} />
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
