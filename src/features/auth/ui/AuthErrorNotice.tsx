import { useState } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'

interface AuthErrorNoticeProps {
  message: string
  onSignOut: () => Promise<void>
}

/**
 * Shows an auth-related error plus a way to recover from it by signing out
 * and retrying. Shared by `LoginPage` (sign-in succeeded but loading the
 * profile failed) and `RequireAuth` (a protected route hit the same error),
 * so a user is never stuck on a screen that looks like it hung.
 */
export function AuthErrorNotice({ message, onSignOut }: AuthErrorNoticeProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSignOut() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await onSignOut()
    } catch (error) {
      setError(toUserMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ErrorBanner message={message} />
      {error && <ErrorBanner message={error} />}
      <Button variant="secondary" onClick={handleSignOut} disabled={pending}>
        {pending ? 'Cerrando sesión…' : 'Cerrar sesión e intentar de nuevo'}
      </Button>
    </div>
  )
}
