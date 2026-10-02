import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import { PIN_LENGTH, type Waiter, type WaiterShift } from '../domain/waiter'
import { clearShift, loadShift, saveShift } from '../domain/shiftStorage'
import {
  endWaiterShift,
  getWaiterShift,
  listActiveWaiters,
  startWaiterShift,
} from '../infrastructure/waitersRepository'

const KEYPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

const keyClass = 'min-h-16 text-2xl'

interface WaiterShiftGateProps {
  /** Rendered once a shift is active; `onShiftExpired` drops a shift the server rejected. */
  children: (shift: WaiterShift, onChangeWaiter: () => void, onShiftExpired: () => void) => ReactNode
}

export function WaiterShiftGate({ children }: WaiterShiftGateProps) {
  const [shift, setShift] = useState<WaiterShift | null>(null)
  const [isVerifying, setIsVerifying] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function verify() {
      const stored = loadShift()
      if (!stored) {
        setIsVerifying(false)
        return
      }
      let verified: WaiterShift | null = null
      try {
        verified = await getWaiterShift(stored.token)
      } catch {
        verified = null
      }
      if (cancelled) return
      if (verified) {
        setShift(verified)
      } else {
        clearShift()
      }
      setIsVerifying(false)
    }
    void verify()
    return () => {
      cancelled = true
    }
  }, [])

  const handleStarted = useCallback((started: WaiterShift) => {
    saveShift(started)
    setShift(started)
  }, [])

  const handleExpired = useCallback(() => {
    clearShift()
    setShift(null)
  }, [])

  const handleChangeWaiter = useCallback(() => {
    const current = shift
    handleExpired()
    if (current) void endWaiterShift(current.token).catch(() => undefined)
  }, [shift, handleExpired])

  if (isVerifying) return <Spinner label="Verificando turno…" className="min-h-dvh" />
  if (shift) return <>{children(shift, handleChangeWaiter, handleExpired)}</>
  return <WaiterPicker onStarted={handleStarted} />
}

function WaiterPicker({ onStarted }: { onStarted: (shift: WaiterShift) => void }) {
  const [waiters, setWaiters] = useState<Waiter[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Waiter | null>(null)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const loaded = await listActiveWaiters()
        if (!cancelled) setWaiters(loaded)
      } catch (error) {
        if (!cancelled) setLoadError(toUserMessage(error))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  async function submitPin(waiter: Waiter, digits: string) {
    setIsStarting(true)
    setPinError(null)
    try {
      onStarted(await startWaiterShift(waiter.id, digits))
    } catch (error) {
      setPinError(toUserMessage(error))
      setPin('')
      setIsStarting(false)
    }
  }

  function pressDigit(digit: string) {
    if (!selected || isStarting || pin.length >= PIN_LENGTH) return
    const next = pin + digit
    setPin(next)
    setPinError(null)
    if (next.length === PIN_LENGTH) void submitPin(selected, next)
  }

  function goBack() {
    setSelected(null)
    setPin('')
    setPinError(null)
  }

  if (isLoading) return <Spinner label="Cargando meseros…" className="min-h-dvh" />

  if (!selected) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold text-slate-900">¿Quién está tomando pedidos?</h1>
        {loadError && <ErrorBanner message={loadError} />}
        {!loadError && waiters.length === 0 && (
          <p className="text-slate-600">No hay meseros registrados. Pide al administrador que los dé de alta.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {waiters.map((waiter) => (
            <Button key={waiter.id} size="lg" className="min-h-20 break-words text-xl" onClick={() => setSelected(waiter)}>
              {waiter.fullName}
            </Button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-xs flex-col items-center gap-4 p-4">
      <h1 className="break-words text-center text-2xl font-bold text-slate-900">{selected.fullName}</h1>
      <p className="text-slate-600">Ingresa tu PIN</p>
      <div role="img" aria-label={`PIN: ${pin.length} de ${PIN_LENGTH} dígitos`} className="flex gap-3">
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            className={`h-4 w-4 rounded-full border-2 border-slate-400 ${index < pin.length ? 'bg-slate-900' : 'bg-transparent'}`}
          />
        ))}
      </div>
      {pinError && <ErrorBanner message={pinError} />}
      <div className="grid w-full grid-cols-3 gap-3">
        {KEYPAD_DIGITS.map((digit) => (
          <Button key={digit} variant="secondary" className={keyClass} disabled={isStarting} onClick={() => pressDigit(digit)}>
            {digit}
          </Button>
        ))}
        <Button variant="ghost" className="min-h-16 text-base" disabled={isStarting} onClick={() => setPin('')}>
          Borrar
        </Button>
        <Button variant="secondary" className={keyClass} disabled={isStarting} onClick={() => pressDigit('0')}>
          0
        </Button>
      </div>
      <Button variant="ghost" disabled={isStarting} onClick={goBack}>
        Volver
      </Button>
    </div>
  )
}
