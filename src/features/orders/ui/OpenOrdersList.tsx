import { Link } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { tableLabel, type Order } from '../domain/order'

interface OpenOrdersListProps {
  orders: Order[]
  canCharge: boolean
  disabled?: boolean
  onAddItems: (order: Order) => void
  onCancel: (order: Order) => void
}

export function OpenOrdersList({ orders, canCharge, disabled = false, onAddItems, onCancel }: OpenOrdersListProps) {
  if (orders.length === 0) {
    return <p className="p-4 text-center text-slate-500">No hay pedidos abiertos.</p>
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {orders.map((order) => (
        <li key={order.id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            {order.tableNumber !== null && (
              <span className="rounded-lg bg-red-700 px-3 py-1 text-lg font-bold text-white">{tableLabel(order.tableNumber)}</span>
            )}
            {order.customerName && <span className="min-w-0 break-words font-semibold text-slate-900">{order.customerName}</span>}
          </div>
          {order.waiterName && <p className="text-sm text-slate-500">Atendió: {order.waiterName}</p>}
          <ul className="flex-1 text-slate-700">
            {order.items.map((item) => (
              <li key={item.id} className="break-words">
                {item.productName} × {item.quantity}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={disabled} onClick={() => onAddItems(order)}>
              Agregar productos
            </Button>
            {canCharge && (
              <Link
                to={`/?pedido=${encodeURIComponent(order.id)}`}
                className="inline-flex items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800"
              >
                Cobrar
              </Link>
            )}
            <Button variant="danger" disabled={disabled} onClick={() => onCancel(order)}>
              Cancelar pedido
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}
