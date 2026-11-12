import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from './cn'

interface SheetProps {
  title: string
  /** Short hint under the title; also the dialog's accessible description. */
  description?: string
  onClose: () => void
  children: ReactNode
  /** Pinned below the scrolling content, e.g. the primary action. */
  footer?: ReactNode
  className?: string
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Bottom sheet: modal dialog that closes with Escape or the backdrop and gives focus back to its opener. */
export function Sheet({ title, description, onClose, children, footer, className }: SheetProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // Read while rendering, before an autofocused field inside the sheet takes focus.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (panelRef.current && !panelRef.current.contains(document.activeElement)) panelRef.current.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      if (opener?.isConnected) opener.focus()
    }
  }, [opener])

  function trapTab(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || !panelRef.current) return
    const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) {
      event.preventDefault()
      return
    }
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div data-testid="sheet-backdrop" aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-slate-900/50 dark:bg-black/60" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl focus:outline-none sm:max-w-lg',
          className,
        )}
      >
        <header className="flex items-start gap-3 border-b border-slate-200 py-3 pl-4 pr-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-bold leading-6 text-slate-900">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="text-sm text-slate-600">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 shrink-0 rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-800 hover:bg-slate-100"
          >
            Cerrar
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && (
          <div className="border-t border-slate-300 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>
        )}
      </div>
    </div>
  )
}
