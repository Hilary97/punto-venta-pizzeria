import { useEffect, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import { toUserMessage } from '../../../shared/errors'
import type { AdminWaiter } from '../domain/waiter'
import {
  adminCreateWaiter,
  adminListWaiters,
  adminResetWaiterPin,
  adminUnlockWaiter,
  adminUpdateWaiter,
} from '../infrastructure/waitersRepository'
import { DevicesSection } from './DevicesSection'
import { WaiterFormModal } from './WaiterFormModal'
import { WaiterPinModal } from './WaiterPinModal'
import { WaitersTable } from './WaitersTable'

type ModalState =
  | { kind: 'none' }
  | { kind: 'new' }
  | { kind: 'edit'; waiter: AdminWaiter }
  | { kind: 'pin'; waiter: AdminWaiter }

export function AdminWaitersPage() {
  const [waiters, setWaiters] = useState<AdminWaiter[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, setIsPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>({ kind: 'none' })

  async function reload() {
    try {
      setWaiters(await adminListWaiters())
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  /** Runs a mutation, reloads the list and reports success. Errors propagate to the caller. */
  async function perform(action: () => Promise<void>, successMessage: string) {
    await action()
    setErrorMessage(null)
    setStatusMessage(successMessage)
    await reload()
  }

  /** Same as `perform`, but for page-level buttons: guards double submit and shows errors in the banner. */
  async function performFromRow(action: () => Promise<void>, successMessage: string) {
    if (isPending) return
    setIsPending(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      await perform(action, successMessage)
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    } finally {
      setIsPending(false)
    }
  }

  async function runFromModal(action: () => Promise<void>, successMessage: string) {
    setStatusMessage(null)
    await perform(action, successMessage)
  }

  if (isLoading) {
    return <Spinner label="Cargando meseros…" />
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Administración de meseros</h1>
        <Button onClick={() => setModal({ kind: 'new' })} disabled={isPending}>
          Nuevo mesero
        </Button>
      </div>

      <p className="text-sm text-slate-600">
        Cada mesero elige su nombre e ingresa su PIN al empezar el turno en el dispositivo de pedidos.
      </p>

      {errorMessage && <ErrorBanner message={errorMessage} />}
      {statusMessage && (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {statusMessage}
        </p>
      )}

      <WaitersTable
        waiters={waiters}
        disabled={isPending}
        onEdit={(waiter) => setModal({ kind: 'edit', waiter })}
        onChangePin={(waiter) => setModal({ kind: 'pin', waiter })}
        onToggleActive={(waiter) =>
          performFromRow(
            () => adminUpdateWaiter(waiter.id, waiter.fullName, !waiter.active),
            waiter.active ? 'Mesero desactivado.' : 'Mesero activado.',
          )
        }
        onUnlock={(waiter) => performFromRow(() => adminUnlockWaiter(waiter.id), 'Mesero desbloqueado.')}
      />

      <DevicesSection />

      {modal.kind === 'new' && (
        <WaiterFormModal
          onSubmit={(name, pin) => runFromModal(() => adminCreateWaiter(name, pin), 'Mesero creado.')}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}

      {modal.kind === 'edit' && (
        <WaiterFormModal
          initialName={modal.waiter.fullName}
          onSubmit={(name) =>
            runFromModal(
              () => adminUpdateWaiter(modal.waiter.id, name, modal.waiter.active),
              'Mesero actualizado.',
            )
          }
          onClose={() => setModal({ kind: 'none' })}
        />
      )}

      {modal.kind === 'pin' && (
        <WaiterPinModal
          waiterName={modal.waiter.fullName}
          onSubmit={(pin) => runFromModal(() => adminResetWaiterPin(modal.waiter.id, pin), 'PIN actualizado.')}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}
    </div>
  )
}
