import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { toUserMessage } from '../../../shared/errors'
import { signInWithPassword, signOut } from '../infrastructure/authRepository'
import { useAuth } from './AuthContext'
import { AuthErrorNotice } from './AuthErrorNotice'

export function LoginPage() {
  const { status, errorMessage: authErrorMessage } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  if (status === 'signed-in') {
    return <Navigate to="/" replace />
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-sm">
          <AuthErrorNotice
            message={authErrorMessage ?? 'Ocurrió un error inesperado.'}
            onSignOut={signOut}
          />
        </div>
      </div>
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setIsSubmitting(true)
    try {
      await signInWithPassword(email, password)
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg"
      >
        <h1 className="mb-1 text-center text-2xl font-bold text-slate-900">Punto de Venta</h1>
        <p className="mb-6 text-center text-sm text-slate-500">Pizzería — inicia sesión para continuar</p>

        {errorMessage && (
          <div className="mb-4">
            <ErrorBanner message={errorMessage} />
          </div>
        )}

        <div className="flex flex-col gap-4">
          <Input
            id="email"
            type="email"
            label="Correo electrónico"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            id="password"
            type="password"
            label="Contraseña"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" size="lg" disabled={isSubmitting} className="mt-2">
            {isSubmitting ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
