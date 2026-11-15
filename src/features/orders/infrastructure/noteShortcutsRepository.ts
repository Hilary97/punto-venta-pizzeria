import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'

export const NOTE_SHORTCUTS_ERROR = 'No se pudieron cargar los atajos de notas.'

/**
 * Labels as returned by `list_note_shortcuts` / `device_list_note_shortcuts`: pizza notes, the order note and,
 * per product category id, the notes of its product lines. `categories` is absent from older servers.
 */
export const noteShortcutsSchema = z.object({
  pizza: z.array(z.string()),
  order: z.array(z.string()),
  categories: z.record(z.string(), z.array(z.string())).default({}),
})

export type NoteShortcuts = z.infer<typeof noteShortcutsSchema>

/** Admin-managed note shortcuts, in order (signed-in admin or cashier). */
export async function listNoteShortcuts(): Promise<NoteShortcuts> {
  const { data, error } = await getSupabaseClient().rpc('list_note_shortcuts')
  if (error) throw new Error(NOTE_SHORTCUTS_ERROR)
  return noteShortcutsSchema.parse(data)
}
