import { useEffect, useState, type FormEvent } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Spinner } from '../../../shared/ui/Spinner'
import { getScheduledLeadMinutes, setScheduledLeadMinutes } from '../infrastructure/orderSettingsRepository'

const MAX_LEAD_MINUTES = 240
const RANGE_MESSAGE = 'La anticipación debe estar entre 0 y 240 minutos.'

/** Admin setting: how many minutes before the pickup time a scheduled order enters the kitchen queue. */
export function ScheduledLeadSection() {
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    getScheduledLeadMinutes().then(
      (minutes) => {
        if (cancelled) return
        setInput(String(minutes))
        setIsLoading(false)
      },
      (error: unknown) => {
        if (cancelled) return
        setErrorMessage(toUserMessage(error))
        setIsLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(false)
    const text = input.trim()
    if (!/^\d+$/.test(text) || Number(text) > MAX_LEAD_MINUTES) {
      setErrorMessage(RANGE_MESSAGE)
      return
    }

    setErrorMessage(null)
    setIsSaving(true)
    try {
      setInput(String(await setScheduledLeadMinutes(Number(text))))
      setSaved(true)
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section aria-labelledby="scheduled-lead-heading" className="flex flex-col gap-3">
      <h2 id="scheduled-lead-heading" className="text-xl font-bold text-slate-900">
        Pedidos programados
      </h2>
      <p className="text-sm text-slate-500">
        Los pedidos programados entran a cocina estos minutos antes de su hora de entrega.
      </p>

      {errorMessage && <ErrorBanner message={errorMessage} />}
      {isLoading ? (
        <Spinner label="Cargando anticipación…" />
      ) : (
        <form onSubmit={handleSubmit} noValidate className="flex flex-wrap items-end gap-3">
          <Input
            id="scheduled-lead-minutes"
            label="Minutos de anticipación"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_LEAD_MINUTES}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <Button type="submit" disabled={isSaving}>
            Guardar
          </Button>
        </form>
      )}
      {saved && (
        <p role="status" className="text-sm font-medium text-green-700">
          Anticipación guardada.
        </p>
      )}
    </section>
  )
}
