import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getSupabaseClient, isSupabaseConfigured } from '../../../shared/supabase/client'
import { fetchOwnProfile, type AuthenticatedProfile } from '../infrastructure/authRepository'

type AuthStatus = 'loading' | 'signed-out' | 'signed-in' | 'error'

interface AuthState {
  status: AuthStatus
  profile: AuthenticatedProfile | null
  errorMessage: string | null
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', profile: null, errorMessage: null })

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setState({
        status: 'error',
        profile: null,
        errorMessage:
          'La aplicación no está configurada: define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en tu archivo .env.',
      })
      return
    }

    const supabase = getSupabaseClient()

    let active = true
    let revision = 0
    let profileTimer: ReturnType<typeof setTimeout> | undefined
    const isCurrent = (version: number) => active && version === revision

    function showError(error: unknown, version: number) {
      if (!isCurrent(version)) return
      setState({
        status: 'error',
        profile: null,
        errorMessage: error instanceof Error ? error.message : 'No se pudo cargar el perfil del usuario.',
      })
    }

    async function loadProfileForUser(userId: string, version: number) {
      try {
        const profile = await fetchOwnProfile(userId)
        if (isCurrent(version)) setState({ status: 'signed-in', profile, errorMessage: null })
      } catch (error) {
        showError(error, version)
      }
    }

    function applySession(userId: string | undefined) {
      if (!active) return
      const version = ++revision
      clearTimeout(profileTimer)
      if (userId) {
        setState({ status: 'loading', profile: null, errorMessage: null })
        // Supabase callbacks run under its auth lock; start SDK work in a later task.
        profileTimer = setTimeout(() => {
          if (isCurrent(version)) void loadProfileForUser(userId, version)
        }, 0)
      } else {
        setState({ status: 'signed-out', profile: null, errorMessage: null })
      }
    }

    const initialRevision = revision
    supabase.auth.getSession().then(({ data, error }) => {
      if (!isCurrent(initialRevision)) return
      if (error) showError(error, initialRevision)
      else applySession(data.session?.user.id)
    }).catch((error: unknown) => showError(error, initialRevision))

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session?.user.id)
    })

    return () => {
      active = false
      clearTimeout(profileTimer)
      subscription.subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>.')
  }
  return context
}
