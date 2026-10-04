import { cn } from '../../../shared/ui/cn'

interface OrderFabProps {
  itemCount: number
  /** Label of the open order receiving products; `null` for a new order. */
  targetLabel?: string | null
  onOpen: () => void
}

export function OrderFab({ itemCount, targetLabel = null, onOpen }: OrderFabProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 rounded-2xl px-5 py-4 font-semibold shadow-lg lg:hidden',
        targetLabel ? 'bg-amber-500 text-amber-950' : 'bg-red-700 text-white',
      )}
    >
      {targetLabel ? `Agregar a ${targetLabel} (${itemCount})` : `Ver pedido (${itemCount})`}
    </button>
  )
}
