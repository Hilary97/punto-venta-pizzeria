import type { TextareaHTMLAttributes } from 'react'
import { cn } from './cn'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export function Textarea({ label, error, id, className, ...props }: TextareaProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <textarea
        id={id}
        rows={2}
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
