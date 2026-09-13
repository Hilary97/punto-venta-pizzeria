import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

const VARIANT_CLASSES = {
  primary: 'bg-red-700 text-white hover:bg-red-800 active:bg-red-900',
  secondary: 'bg-slate-200 text-slate-900 hover:bg-slate-300 active:bg-slate-400',
  success: 'bg-emerald-700 text-white hover:bg-emerald-800 active:bg-emerald-900',
  danger: 'bg-red-100 text-red-800 hover:bg-red-200 active:bg-red-300',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 active:bg-slate-200',
} as const

export type ButtonVariant = keyof typeof VARIANT_CLASSES

const SIZE_CLASSES = {
  md: 'px-4 py-2.5 text-base',
  lg: 'px-6 py-4 text-lg',
} as const

export type ButtonSize = keyof typeof SIZE_CLASSES

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold shadow-sm transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-600',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  )
}
