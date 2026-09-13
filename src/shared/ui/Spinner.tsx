import { cn } from './cn'

interface SpinnerProps {
  label?: string
  className?: string
}

export function Spinner({ label = 'Cargando…', className }: SpinnerProps) {
  return (
    <div className={cn('flex items-center justify-center gap-3 p-8 text-slate-600', className)} role="status">
      <span className="h-6 w-6 animate-spin rounded-full border-4 border-slate-300 border-t-red-700" />
      <span>{label}</span>
    </div>
  )
}
