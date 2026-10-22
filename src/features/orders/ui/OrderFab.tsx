import { cn } from '../../../shared/ui/cn'

interface OrderFabProps {
  itemCount: number
  /** Label of the open order receiving products; `null` for a new order. */
  targetLabel?: string | null
  onOpen: () => void
}

/** Compact pill bottom-right on phones; the open orders pill sits bottom-left on the same line. */
export function OrderFab({ itemCount, targetLabel = null, onOpen }: OrderFabProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'fixed right-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 flex max-w-[calc(50%-1rem)] items-center gap-1 rounded-full px-4 py-2.5 text-sm font-semibold shadow-md lg:hidden',
        targetLabel ? 'bg-amber-500 text-amber-950' : 'bg-red-700 text-white',
      )}
    >
      {/* The label may be cut short; the item count always stays visible. */}
      <span className="truncate">{targetLabel ? `Agregar a ${targetLabel}` : 'Ver pedido'}</span>{' '}
      <span className="shrink-0">({itemCount})</span>
    </button>
  )
}
