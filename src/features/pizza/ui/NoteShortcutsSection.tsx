import { useEffect, useId, useState, type ReactNode } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Spinner } from '../../../shared/ui/Spinner'
import {
  addCategoryNoteShortcut,
  addNoteShortcut,
  deleteNoteShortcut,
  listAdminCategoryNoteShortcuts,
  listAdminNoteShortcuts,
  moveNoteShortcut,
  type NoteShortcut,
  type NoteShortcutScope,
} from '../infrastructure/noteShortcutAdminRepository'

const MAX_LABEL_LENGTH = 40

const COPY: Record<NoteShortcutScope | 'category', { title: string; hint: string; empty: string; placeholder: string }> = {
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
  category: {
    title: 'Atajos de notas por categoría',
    hint: 'El mesero los toca bajo la nota de cada producto de la categoría al revisar el pedido. Hasta 12 atajos por categoría.',
    empty: 'Esta categoría no tiene atajos: el mesero escribe las notas a mano.',
    placeholder: 'Ej. Sin pepinillos',
  },
}

type NoteShortcutsSectionProps =
  | { scope: NoteShortcutScope; categoryId?: undefined; children?: undefined }
  /** `children` (e.g. the category picker) show under the heading. */
  | { scope: 'category'; categoryId: string; children?: ReactNode }

function fetchShortcuts(scope: NoteShortcutScope | 'category', categoryId: string | undefined) {
  return scope === 'category' ? listAdminCategoryNoteShortcuts(categoryId!) : listAdminNoteShortcuts(scope)
}

/**
 * Admin: one list of note shortcuts the waiter taps: pizza notes or the order note (Admin > Pizzas), or the
 * product line notes of one category (Admin > Productos).
 */
export function NoteShortcutsSection({ scope, categoryId, children }: NoteShortcutsSectionProps) {
  const copy = COPY[scope]
  const id = useId()
  // Results are tied to the list they were loaded for, so switching category never shows the previous one.
  const listKey = `${scope}:${categoryId ?? ''}`
  const [loaded, setLoaded] = useState<{ key: string; shortcuts: NoteShortcut[] } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const [label, setLabel] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const shortcuts = loaded?.key === listKey ? loaded.shortcuts : null
  const errorMessage = failure?.key === listKey ? failure.message : null

  function setErrorMessage(message: string | null) {
    setFailure(message === null ? null : { key: listKey, message })
  }

  async function reload() {
    try {
      setLoaded({ key: listKey, shortcuts: await fetchShortcuts(scope, categoryId) })
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    }
  }

  useEffect(() => {
    let cancelled = false
    fetchShortcuts(scope, categoryId).then(
      (list) => {
        if (!cancelled) setLoaded({ key: listKey, shortcuts: list })
      },
      (error: unknown) => {
        if (!cancelled) setFailure({ key: listKey, message: toUserMessage(error) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [scope, categoryId, listKey])

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
    const text = label.trim()
    const added = await run(() => (scope === 'category' ? addCategoryNoteShortcut(categoryId, text) : addNoteShortcut(scope, text)))
    if (added) setLabel('')
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
      {children}

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
