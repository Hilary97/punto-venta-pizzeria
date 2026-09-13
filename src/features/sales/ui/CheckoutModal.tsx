import { useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { MoneyText } from '../../../shared/ui/MoneyText'
import { Modal } from '../../../shared/ui/Modal'
import { formatMoney, parseMoneyInput } from '../../../shared/money'
import { calculateChangeCents } from '../domain/change'

interface CheckoutModalProps {
  totalCents: number
  onConfirm: (receivedCents: number) => void | Promise<void>
  onClose: () => void
  isSubmitting?: boolean
}

export function CheckoutModal({ totalCents, onConfirm, onClose, isSubmitting = false }: CheckoutModalProps) {
  const [receivedInput, setReceivedInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const receivedCents = parseMoneyInput(receivedInput)
  const changeCents =
    receivedCents !== null && receivedCents >= totalCents ? calculateChangeCents(totalCents, receivedCents) : null
  const canConfirm = changeCents !== null && !isSubmitting

  async function handleConfirm() {
    if (!canConfirm || receivedCents === null) return
    setError(null)
    try {
      await onConfirm(receivedCents)
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'No se pudo registrar la venta.')
    }
  }

  return (
    <Modal title="Cobrar" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}

        <div className="flex items-center justify-between text-lg font-semibold text-slate-900">
          <span>Total a pagar</span>
          <MoneyText cents={totalCents} className="text-2xl font-bold text-red-700" />
        </div>

        <Input
          id="received-amount"
          label="Monto recibido"
          inputMode="decimal"
          placeholder="0.00"
          autoFocus
          value={receivedInput}
          onChange={(e) => setReceivedInput(e.target.value)}
        />

        <div className="rounded-xl bg-slate-100 p-4 text-center">
          {changeCents !== null ? (
            <>
              <p className="text-sm font-medium text-slate-500">Cambio</p>
              <p className="text-3xl font-bold text-emerald-700">{formatMoney(changeCents)}</p>
            </>
          ) : (
            <p className="font-medium text-slate-500">
              {receivedInput === '' ? 'Ingresa el monto recibido.' : 'El monto recibido es insuficiente.'}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!canConfirm}>
            {isSubmitting ? 'Procesando…' : 'Confirmar'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
