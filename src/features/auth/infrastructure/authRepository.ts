import { getSupabaseClient } from '../../../shared/supabase/client'
import type { UserRole } from '../../../shared/supabase/database.types'
import { toSignInErrorMessage } from '../domain/signInError'
import { toProfileErrorMessage } from '../domain/profileError'

export interface AuthenticatedProfile {
  id: string
  fullName: string
  role: UserRole
}

/** Signs in with email/password. Throws with a Spanish message on failure. */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithPassword({ email, password })
  if (error) {
    throw new Error(toSignInErrorMessage(error))
  }
}

export async function signOut(): Promise<void> {
  try {
    const { error } = await getSupabaseClient().auth.signOut()
    if (error) throw error
  } catch {
    throw new Error('No se pudo cerrar la sesión. Intenta de nuevo.')
  }
}

/** Loads the profile (full name + role) for the currently authenticated user. */
export async function fetchOwnProfile(userId: string): Promise<AuthenticatedProfile> {
  const { data, error } = await getSupabaseClient()
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', userId)
    .maybeSingle()

  if (error || !data) {
    throw new Error(toProfileErrorMessage(error, Boolean(data)))
  }

  return { id: data.id, fullName: data.full_name, role: data.role }
}
