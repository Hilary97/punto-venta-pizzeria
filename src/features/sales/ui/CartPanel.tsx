import { Button } from '../../../shared/ui/Button'
import { MoneyText } from '../../../shared/ui/MoneyText'
import { cartTotalCents, type CartItem } from '../domain/cart'

interface CartPanelProps {
  cart: CartItem[]
  onIncrement: (productId: string) => void
  onDecrement: (productId: string) => void
  onRemove: (productId: string) => void
  onCheckout?: () => void
  disabled?: boolean
}

export function CartPanel({ cart, onIncrement, onDecrement, onRemove, onCheckout, disabled = false }: CartPanelProps) {
  const total = cartTotalCents(cart)

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h2 className="text-lg font-bold text-slate-900">Carrito</h2>

      {cart.length === 0 ? (
        <p className="flex-1 text-center text-slate-500">Agrega productos para iniciar la venta.</p>
      ) : (
        <ul className="flex-1 divide-y divide-slate-200 overflow-y-auto">
          {cart.map((item) => (
            <li key={item.productId} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0 basis-full">
                <p className="break-words font-medium text-slate-900">{item.name}</p>
                <MoneyText cents={item.unitPriceCents} className="text-sm text-slate-500" />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Quitar una unidad de ${item.name}`}
                  disabled={disabled}
                  onClick={() => onDecrement(item.productId)}
                  className="h-11 w-11 rounded-full bg-slate-200 font-bold text-slate-700 hover:bg-slate-300"
                >
                  −
                </button>
                <span className="w-6 text-center font-semibold">{item.quantity}</span>
                <button
                  type="button"
                  aria-label={`Agregar una unidad de ${item.name}`}
                  disabled={disabled}
                  onClick={() => onIncrement(item.productId)}
                  className="h-11 w-11 rounded-full bg-slate-200 font-bold text-slate-700 hover:bg-slate-300"
                >
                  +
                </button>
              </div>
              <MoneyText cents={item.unitPriceCents * item.quantity} className="w-20 text-right font-semibold" />
              <button
                type="button"
                aria-label={`Eliminar ${item.name} del carrito`}
                disabled={disabled}
                onClick={() => onRemove(item.productId)}
                className="p-2 text-slate-400 hover:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-slate-200 pt-3">
        <div className="mb-3 flex items-center justify-between text-xl font-bold text-slate-900">
          <span>Total</span>
          <MoneyText cents={total} />
        </div>
        {onCheckout && (
          <Button size="lg" className="w-full" disabled={disabled || cart.length === 0} onClick={onCheckout}>
            Cobrar
          </Button>
        )}
      </div>
    </div>
  )
}
