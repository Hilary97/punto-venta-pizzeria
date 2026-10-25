import { useEffect, useState } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Modal } from '../../../shared/ui/Modal'
import { fetchKitchenEnabled, setKitchenEnabled } from '../infrastructure/kitchenSettingsRepository'

interface KitchenSwitchProps {
  /** Admins can turn the kitchen on and off; others only see the notice. */
  canEdit: boolean
}

/** Kitchen on/off state: off means orders are tracked on paper and skip Cocina and Entrega. */
export function KitchenSwitch({ canEdit }: KitchenSwitchProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchKitchenEnabled()
      .then((value) => {
        if (!cancelled) setEnabled(value)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toUserMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function change(next: boolean) {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      setEnabled(await setKitchenEnabled(next))
      setConfirming(false)
    } catch (err) {
      setConfirming(false)
      setError(toUserMessage(err))
    } finally {
      setPending(false)
    }
  }

  if (!canEdit && enabled !== false) return null

  return (
    <div className="flex flex-col gap-2 px-4 pt-4">
      {error && <ErrorBanner message={error} />}
      {enabled === false && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          Cocina desactivada: los pedidos no pasan por Cocina ni Entrega.
        </p>
      )}
      {canEdit && enabled !== null && (
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-700">
            Cocina con pantallas: {enabled ? 'activada' : 'desactivada'}
          </span>
          {enabled ? (
            <Button variant="danger" disabled={pending} onClick={() => setConfirming(true)}>
              Desactivar cocina
            </Button>
          ) : (
            <Button variant="success" disabled={pending} onClick={() => change(true)}>
              Activar cocina
            </Button>
          )}
        </div>
      )}
      {confirming && (
        <Modal title="¿Desactivar la cocina?" onClose={() => setConfirming(false)}>
          <p className="text-sm text-slate-700">
            Los pedidos pendientes en Cocina y Entrega se darán por terminados. Los pedidos nuevos no pasarán por la cocina.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={pending} onClick={() => change(false)}>
              Desactivar
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
