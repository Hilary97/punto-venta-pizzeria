import { Button } from '../../../shared/ui/Button'
import { orderLabel, type Order } from '../domain/order'

interface AddingToOrderBarProps {
  order: Order
  disabled?: boolean
  onCancel: () => void
}

/** Highlights the open order that is receiving new products. */
export function AddingToOrderBar({ order, disabled = false, onCancel }: AddingToOrderBarProps) {
  const itemCount = order.items.reduce((total, item) => total + item.quantity, 0)

  return (
    <section
      aria-label="Pedido en edición"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3"
    >
      <p className="min-w-0 break-words text-amber-900">
        <span className="font-bold">Agregando al pedido {orderLabel(order)}</span>
        <span className="block text-sm">
          ya tiene {itemCount} {itemCount === 1 ? 'producto' : 'productos'}
        </span>
      </p>
      <Button variant="secondary" disabled={disabled} onClick={onCancel}>
        Cancelar
      </Button>
    </section>
  )
}
