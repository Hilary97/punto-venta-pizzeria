import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { Spinner } from '../../../shared/ui/Spinner'
import { toUserMessage } from '../../../shared/errors'
import { signOut } from '../../auth/infrastructure/authRepository'
import type { AdminDevice } from '../domain/device'
import { clearDevice, loadDevice, saveDevice } from '../domain/deviceStorage'
import { clearShift } from '../domain/shiftStorage'
import { MAX_WAITER_NAME_LENGTH, isValidWaiterName, normalizeWaiterName } from '../domain/waiter'
import { adminListDevices, adminRegisterDevice, adminRevokeDevice } from '../infrastructure/waitersRepository'

function formatLastSeen(lastSeenAt: string | null): string {
  if (lastSeenAt === null) return 'Nunca'
  const date = new Date(lastSeenAt)
  if (Number.isNaN(date.getTime())) return 'Nunca'
  return date.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
}

interface AuthorizeDeviceModalProps {
  onClose: () => void
}

function AuthorizeDeviceModal({ onClose }: AuthorizeDeviceModalProps) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    if (!isValidWaiterName(name)) {
      setError(`El nombre debe tener entre 1 y ${MAX_WAITER_NAME_LENGTH} caracteres.`)
      return
    }

    setError(null)
    setIsSubmitting(true)
    try {
      const device = await adminRegisterDevice(normalizeWaiterName(name))
      saveDevice({ deviceId: device.deviceId, name: device.name, secret: device.secret })
      clearShift()
    } catch (submitError) {
      setError(toUserMessage(submitError))
      setIsSubmitting(false)
      return
    }

    // The device already works without a session, so a failed sign-out must not block the switch.
    try {
      await signOut()
    } catch {
      // Ignored on purpose: the admin can sign out manually.
    }
    navigate('/pedidos', { replace: true })
  }

  return (
    <Modal title="Usar este dispositivo para pedidos" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <p className="text-sm text-amber-800">
          Al autorizar este dispositivo se cerrará tu sesión de administrador en este navegador.
        </p>
        <Input
          id="device-name"
          label="Nombre del dispositivo"
          placeholder="Tablet barra"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Autorizando…' : 'Autorizar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

type ModalState = { kind: 'none' } | { kind: 'authorize' } | { kind: 'revoke'; device: AdminDevice }

export function DevicesSection() {
  const [devices, setDevices] = useState<AdminDevice[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, setIsPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>({ kind: 'none' })
  const [thisDevice, setThisDevice] = useState(() => loadDevice())

  async function reload() {
    try {
      setDevices(await adminListDevices())
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  async function revoke(device: AdminDevice) {
    if (isPending) return
    setIsPending(true)
    setErrorMessage(null)
    try {
      await adminRevokeDevice(device.id)
      await reload()
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    } finally {
      setModal({ kind: 'none' })
      setIsPending(false)
    }
  }

  function removeThisDevice() {
    clearDevice()
    clearShift()
    setThisDevice(null)
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="devices-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="devices-title" className="text-xl font-bold text-slate-900">
          Dispositivos de pedidos
        </h2>
        <Button onClick={() => setModal({ kind: 'authorize' })} disabled={isPending}>
          Usar este dispositivo para pedidos
        </Button>
      </div>

      <p className="text-sm text-slate-600">
        Autoriza la tablet o celular de los meseros. Después de autorizarlo se cierra tu sesión y el dispositivo abre
        directo en Pedidos; los meseros entran con su nombre y PIN.
      </p>

      {thisDevice && (
        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <p>
            Este navegador ya está autorizado como {thisDevice.name}. Quitar la autorización solo lo desvincula aquí;
            para revocarlo en el servidor usa la lista.
          </p>
          <div>
            <Button variant="secondary" onClick={removeThisDevice}>
              Quitar autorización de este navegador
            </Button>
          </div>
        </div>
      )}

      {errorMessage && <ErrorBanner message={errorMessage} />}

      {isLoading ? (
        <Spinner label="Cargando dispositivos…" />
      ) : devices.length === 0 ? (
        <p className="p-4 text-center text-slate-500">Aún no hay dispositivos autorizados.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Dispositivo</th>
                <th className="px-4 py-3 font-semibold">Último uso</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
                <th className="px-4 py-3 font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {devices.map((device) => (
                <tr key={device.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{device.name}</td>
                  <td className="px-4 py-3 text-slate-700">{formatLastSeen(device.lastSeenAt)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        device.revoked
                          ? 'rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-600'
                          : 'rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800'
                      }
                    >
                      {device.revoked ? 'Revocado' : 'Activo'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {!device.revoked && (
                      <Button variant="ghost" disabled={isPending} onClick={() => setModal({ kind: 'revoke', device })}>
                        Revocar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal.kind === 'authorize' && <AuthorizeDeviceModal onClose={() => setModal({ kind: 'none' })} />}

      {modal.kind === 'revoke' && (
        <Modal title="Revocar dispositivo" onClose={() => setModal({ kind: 'none' })}>
          <div className="flex flex-col gap-4">
            <p className="text-slate-700">
              ¿Revocar {modal.device.name}? Ese dispositivo dejará de poder registrar pedidos.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setModal({ kind: 'none' })} disabled={isPending}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={() => void revoke(modal.device)} disabled={isPending}>
                Revocar
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}
