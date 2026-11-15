import { Link } from 'react-router'

/** Full-screen notice for a device the server no longer authorizes, with a way to sign in. */
export function RevokedDeviceScreen({ area }: { area: 'pedidos' | 'cocina' }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
      <p className="max-w-md text-lg text-slate-800">
        Este dispositivo ya no está autorizado para {area}. Pide a un administrador que lo autorice de nuevo.
      </p>
      <Link to="/login" className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white">
        Iniciar sesión
      </Link>
    </div>
  )
}
