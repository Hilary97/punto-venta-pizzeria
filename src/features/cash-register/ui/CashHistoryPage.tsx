import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Modal } from '../../../shared/ui/Modal'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { MoneyText } from '../../../shared/ui/MoneyText'
import { Spinner } from '../../../shared/ui/Spinner'
import { toUserMessage } from '../../../shared/errors'
import type { CashSession } from '../domain/cashSession'
import { deleteClosedCashSession, listPastSessions } from '../infrastructure/cashRegisterRepository'

export function CashHistoryPage() {
  const [sessions, setSessions] = useState<CashSession[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [selectedSession, setSelectedSession] = useState<CashSession | null>(null)
  const [deletionError, setDeletionError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const deletionInFlight = useRef(false)

  function closeConfirmation() {
    if (deletionInFlight.current) return
    setSelectedSession(null)
    setDeletionError(null)
  }

  async function confirmDeletion() {
    if (!selectedSession || deletionInFlight.current) return
    deletionInFlight.current = true
    setIsDeleting(true)
    setDeletionError(null)
    try {
      const deletedId = await deleteClosedCashSession(selectedSession.id)
      setSessions((current) => current.filter((session) => session.id !== deletedId))
      setSelectedSession(null)
    } catch (error) {
      setDeletionError(toUserMessage(error))
    } finally {
      deletionInFlight.current = false
      setIsDeleting(false)
    }
  }

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
                <th className="px-4 py-3 font-semibold">Acciones</th>
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
                  <td className="px-4 py-3">
                    {session.closedAt && (
                      <Button
                        variant="danger"
                        disabled={isDeleting}
                        aria-label={`Eliminar corte del ${new Date(session.openedAt).toLocaleString('es-MX')}`}
                        onClick={() => {
                          if (deletionInFlight.current) return
                          setDeletionError(null)
                          setSelectedSession(session)
                        }}
                      >
                        Eliminar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedSession && (
        <Modal title="Eliminar corte definitivamente" onClose={closeConfirmation}>
          <fieldset disabled={isDeleting} className="flex flex-col gap-4" aria-busy={isDeleting}>
            <p>
              Se eliminará el corte abierto el {new Date(selectedSession.openedAt).toLocaleString('es-MX')},
              incluyendo sus ventas y devoluciones. Esta acción es irreversible.
              La caja abierta no se modifica.
            </p>
            {deletionError && <ErrorBanner message={deletionError} />}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" autoFocus onClick={closeConfirmation}>Cancelar</Button>
              <Button variant="danger" onClick={() => void confirmDeletion()}>
                {isDeleting ? 'Eliminando…' : 'Eliminar definitivamente'}
              </Button>
            </div>
          </fieldset>
        </Modal>
      )}
    </div>
  )
}
