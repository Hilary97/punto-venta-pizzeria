import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'

export const NOTE_SHORTCUTS_ERROR = 'No se pudieron cargar los atajos de notas.'

/** Labels as returned by `list_note_shortcuts` / `device_list_note_shortcuts`: pizza notes and order note. */
export const noteShortcutsSchema = z.object({ pizza: z.array(z.string()), order: z.array(z.string()) })

export type NoteShortcuts = z.infer<typeof noteShortcutsSchema>

/** Admin-managed note shortcuts, in order (signed-in admin or cashier). */
export async function listNoteShortcuts(): Promise<NoteShortcuts> {
  const { data, error } = await getSupabaseClient().rpc('list_note_shortcuts')
  if (error) throw new Error(NOTE_SHORTCUTS_ERROR)
  return noteShortcutsSchema.parse(data)
}
