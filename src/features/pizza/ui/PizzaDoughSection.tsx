import { useEffect, useState } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import type { PizzaDoughDay, PizzaDoughSize } from '../domain/pizzaDough'
import { listPizzaDough, setPizzaDough } from '../infrastructure/pizzaDoughRepository'
import { PizzaDoughModal } from './PizzaDoughModal'

/** Admin view of the current shift's doughs per pizza size, with the action to load them. */
export function PizzaDoughSection() {
  const [day, setDay] = useState<PizzaDoughDay | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [editing, setEditing] = useState<PizzaDoughSize | null>(null)

  function show(result: PizzaDoughDay | Error) {
    if (result instanceof Error) {
      setErrorMessage(toUserMessage(result))
    } else {
      setDay(result)
      setErrorMessage(null)
    }
    setIsLoading(false)
  }

  async function reload() {
    show(await listPizzaDough().catch((error: unknown) => (error instanceof Error ? error : new Error(toUserMessage(error)))))
  }

  useEffect(() => {
    let cancelled = false
    listPizzaDough().then(
      (loaded) => !cancelled && show(loaded),
      (error: unknown) => !cancelled && show(error instanceof Error ? error : new Error(toUserMessage(error))),
    )
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(prepared: number) {
    if (!editing) return
    await setPizzaDough(editing.sizeCode, prepared)
    await reload()
  }

  return (
    <section aria-labelledby="pizza-dough-heading" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="pizza-dough-heading" className="text-xl font-bold text-slate-900">
          Masas del día
        </h2>
        {day && <p className="text-sm text-slate-500">Desde {new Date(day.shiftStartedAt).toLocaleString('es-MX')}</p>}
      </div>
      <p className="text-sm text-slate-500">
        Se reinician al cerrar la caja: hasta que vuelvas a cargarlas, las pizzas quedan sin límite.
      </p>

      {errorMessage && <ErrorBanner message={errorMessage} />}
      {isLoading && <Spinner label="Cargando masas…" />}

      {day && (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Tamaño</th>
                <th className="px-4 py-3 font-semibold">Preparadas</th>
                <th className="px-4 py-3 font-semibold">Pizzas hechas</th>
                <th className="px-4 py-3 font-semibold">Quedan</th>
                <th className="px-4 py-3 font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {day.sizes.map((size) => (
                <tr key={size.sizeCode}>
                  <td className="px-4 py-3 font-medium text-slate-900">{size.name}</td>
                  <td className="px-4 py-3">{size.prepared ?? 'Sin límite'}</td>
                  <td className="px-4 py-3">{size.used ?? '—'}</td>
                  <td className="px-4 py-3">{size.left ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="md" onClick={() => setEditing(size)}>
                      Cargar masas
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <PizzaDoughModal
          sizeName={editing.name}
          prepared={editing.prepared}
          onSubmit={handleSubmit}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}
