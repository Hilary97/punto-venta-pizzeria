import type { ReactNode } from 'react'
import { cn } from '../../../shared/ui/cn'

interface StepBarProps {
  /** Phones in the app layout have a 68px bottom nav; the bar sits above it. Device apps have none. */
  aboveBottomNav: boolean
  children: ReactNode
}

/** Fixed bottom bar holding the primary action of a step. */
export function StepBar({ aboveBottomNav, children }: StepBarProps) {
  return (
    <div
      data-step-bar
      className={cn(
        'fixed inset-x-0 z-30 mx-auto w-full max-w-2xl border-t border-slate-200 bg-white px-4 pt-3 sm:rounded-t-2xl sm:border-x',
        aboveBottomNav
          ? 'bottom-[calc(68px+env(safe-area-inset-bottom))] pb-3 sm:bottom-0 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]'
          : 'bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
      )}
    >
      <div className="flex w-full flex-col gap-2">{children}</div>
    </div>
  )
}
