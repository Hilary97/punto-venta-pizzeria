import type { InputHTMLAttributes } from 'react'
import { cn } from './cn'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({ label, error, id, className, ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <input
        id={id}
        className={cn(
          'rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900',
          'focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-200',
          error && 'border-red-500 focus:border-red-500 focus:ring-red-200',
          className,
        )}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
