import { useEffect, useId, useState } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Spinner } from '../../../shared/ui/Spinner'
import {
  addNoteShortcut,
  deleteNoteShortcut,
  listAdminNoteShortcuts,
  moveNoteShortcut,
  type NoteShortcut,
  type NoteShortcutScope,
} from '../infrastructure/noteShortcutAdminRepository'

const MAX_LABEL_LENGTH = 40

const COPY: Record<NoteShortcutScope, { title: string; hint: string; empty: string; placeholder: string }> = {
  pizza: {
    title: 'Atajos de notas de pizza',
    hint: 'El mesero los toca en "Armar pizza" para llenar la nota de cada porción y la nota de la pizza. Hasta 12 atajos.',
    empty: 'Todavía no agregaste ningún atajo: el mesero escribe las notas a mano.',
    placeholder: 'Ej. Sin cebolla',
  },
  order: {
    title: 'Atajos de nota del pedido',
    hint: 'El mesero los toca bajo "Nota del pedido" al revisar el pedido y al editar su nota. Hasta 12 atajos.',
    empty: 'Todavía no agregaste ningún atajo: el mesero escribe la nota del pedido a mano.',
    placeholder: 'Ej. Pagan con $500',
  },
}

/** Admin > Pizzas: one list of note shortcuts (pizza notes or the order note) the waiter taps. */
export function NoteShortcutsSection({ scope }: { scope: NoteShortcutScope }) {
  const copy = COPY[scope]
  const id = useId()
  const [shortcuts, setShortcuts] = useState<NoteShortcut[] | null>(null)
  const [label, setLabel] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  async function reload() {
    try {
      setShortcuts(await listAdminNoteShortcuts(scope))
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    }
  }

  useEffect(() => {
    let cancelled = false
    listAdminNoteShortcuts(scope).then(
      (loaded) => {
        if (!cancelled) setShortcuts(loaded)
      },
      (error: unknown) => {
        if (!cancelled) setErrorMessage(toUserMessage(error))
      },
    )
    return () => {
      cancelled = true
    }
  }, [scope])

  /** Runs a server action; returns whether it succeeded. The list is reloaded either way. */
  async function run(action: () => Promise<void>): Promise<boolean> {
    setIsBusy(true)
    setErrorMessage(null)
    let ok = false
    try {
      await action()
      ok = true
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    } finally {
      await reload()
      setIsBusy(false)
    }
    return ok
  }

  async function handleAdd() {
    if (await run(() => addNoteShortcut(scope, label.trim()))) setLabel('')
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <div>
        <h2 id={`${id}-heading`} className="text-xl font-bold text-slate-900">
          {copy.title}
        </h2>
        <p className="text-sm text-slate-500">
          {copy.hint}
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (label.trim() !== '' && !isBusy) void handleAdd()
        }}
      >
        <div className="min-w-0 flex-1">
          <Input
            id={`${id}-label`}
            label="Nuevo atajo"
            value={label}
            maxLength={MAX_LABEL_LENGTH}
            placeholder={copy.placeholder}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={isBusy || label.trim() === ''}>
          Agregar atajo
        </Button>
      </form>

      {errorMessage && <ErrorBanner message={errorMessage} />}

      {shortcuts === null && !errorMessage ? (
        <Spinner />
      ) : shortcuts !== null && shortcuts.length === 0 ? (
        <p className="text-sm text-slate-500">{copy.empty}</p>
      ) : (
        shortcuts !== null && (
          <ol aria-label={copy.title} className="flex list-none flex-col gap-2 p-0">
            {shortcuts.map((shortcut, index) => (
              <li
                key={shortcut.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
              >
                <span className="w-6 text-sm font-bold text-slate-500">{index + 1}</span>
                <p data-testid="note-shortcut-label" className="min-w-0 flex-1 break-words font-medium text-slate-900">
                  {shortcut.label}
                </p>
                <Button variant="ghost" disabled={isBusy || index === 0} onClick={() => void run(() => moveNoteShortcut(shortcut.id, -1))}>
                  Subir
                </Button>
                <Button
                  variant="ghost"
                  disabled={isBusy || index === shortcuts.length - 1}
                  onClick={() => void run(() => moveNoteShortcut(shortcut.id, 1))}
                >
                  Bajar
                </Button>
                <Button variant="ghost" disabled={isBusy} onClick={() => void run(() => deleteNoteShortcut(shortcut.id))}>
                  Quitar
                </Button>
              </li>
            ))}
          </ol>
        )
      )}
    </section>
  )
}
