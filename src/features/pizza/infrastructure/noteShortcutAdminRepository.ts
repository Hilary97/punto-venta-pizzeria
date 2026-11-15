import { z } from 'zod'
import { getSupabaseClient } from '../../../shared/supabase/client'
import { parseRpcResult } from '../../../shared/supabase/rpc'

/** Which list a shortcut belongs to: notes of a pizza or its portions, or the note of the whole order. */
export type NoteShortcutScope = 'pizza' | 'order'

/** A note shortcut as managed in Admin > Pizzas. */
export interface NoteShortcut {
  id: string
  label: string
}

const shortcutsSchema = z.array(z.object({ id: z.string(), label: z.string() }))
const idSchema = z.object({ id: z.string() })

export async function listAdminNoteShortcuts(scope: NoteShortcutScope): Promise<NoteShortcut[]> {
  const { data, error } = await getSupabaseClient().rpc('admin_list_note_shortcuts', { p_scope: scope })
  return parseRpcResult(shortcutsSchema, data, error, 'No se pudieron cargar los atajos de notas.')
}

/** The shortcuts of one product category, managed in Admin > Productos. */
export async function listAdminCategoryNoteShortcuts(categoryId: string): Promise<NoteShortcut[]> {
  const { data, error } = await getSupabaseClient().rpc('admin_list_category_note_shortcuts', { p_category_id: categoryId })
  return parseRpcResult(shortcutsSchema, data, error, 'No se pudieron cargar los atajos de notas.')
}

export async function addCategoryNoteShortcut(categoryId: string, label: string): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('admin_add_category_note_shortcut', {
    p_category_id: categoryId,
    p_label: label,
  })
  parseRpcResult(idSchema, data, error, 'No se pudo agregar el atajo.')
}

export async function addNoteShortcut(scope: NoteShortcutScope, label: string): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('admin_add_note_shortcut', { p_scope: scope, p_label: label })
  parseRpcResult(idSchema, data, error, 'No se pudo agregar el atajo.')
}

export async function deleteNoteShortcut(id: string): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('admin_delete_note_shortcut', { p_id: id })
  parseRpcResult(idSchema, data, error, 'No se pudo quitar el atajo.')
}

export async function moveNoteShortcut(id: string, direction: -1 | 1): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('admin_move_note_shortcut', { p_id: id, p_direction: direction })
  parseRpcResult(idSchema, data, error, 'No se pudo mover el atajo.')
}
