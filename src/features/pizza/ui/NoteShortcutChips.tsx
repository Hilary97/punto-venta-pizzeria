import { canAppendNoteShortcut, hasNoteShortcut, toggleNoteShortcut } from '../domain/pizzaBuilder'
import { cn } from '../../../shared/ui/cn'

interface NoteShortcutChipsProps {
  /** What the chips fill, e.g. `Mitad 1 · Varas`; names the group. */
  label: string
  shortcuts: string[]
  note: string
  maxLength: number
  onChange: (note: string) => void
}

/**
 * Admin-managed shortcuts under a note field: tap adds the label to the note, tap again removes it.
 * Subtle on purpose (small outline, soft amber when on): they sit under a field, not among the main choices.
 */
export function NoteShortcutChips({ label, shortcuts, note, maxLength, onChange }: NoteShortcutChipsProps) {
  if (shortcuts.length === 0) return null
  return (
    <div role="group" aria-label={`Atajos de ${label}`} className="flex flex-wrap gap-1.5">
      {shortcuts.map((shortcut) => {
        const pressed = hasNoteShortcut(note, shortcut)
        // A shortcut that would not fit in the note cannot be added; removing one always works.
        const disabled = !pressed && !canAppendNoteShortcut(note, shortcut, maxLength)
        return (
          <button
            key={shortcut}
            type="button"
            aria-pressed={pressed}
            disabled={disabled}
            onClick={() => onChange(toggleNoteShortcut(note, shortcut, maxLength))}
            className={cn(
              'min-h-8 rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-40',
              pressed
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-100'
                : // No dark: slate overrides: dark mode inverts the slate scale (src/index.css), so these stay readable.
                  'border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100',
            )}
          >
            {shortcut}
          </button>
        )
      })}
    </div>
  )
}
