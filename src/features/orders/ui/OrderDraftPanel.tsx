import type { DraftLine } from '../domain/orderDraft'

interface OrderDraftPanelProps {
  draft: DraftLine[]
  onIncrement: (productId: string) => void
  onDecrement: (productId: string) => void
  onRemove: (productId: string) => void
  disabled?: boolean
}

export function OrderDraftPanel({ draft, onIncrement, onDecrement, onRemove, disabled = false }: OrderDraftPanelProps) {
  if (draft.length === 0) {
    return <p className="text-center text-slate-500">Agrega productos al pedido.</p>
  }

  return (
    <ul className="divide-y divide-slate-200">
      {draft.map((line) => (
        <li key={line.productId} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <p className="min-w-0 flex-1 break-words font-medium text-slate-900">{line.name}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={`Quitar una unidad de ${line.name}`}
              disabled={disabled}
              onClick={() => onDecrement(line.productId)}
              className="h-11 w-11 rounded-full bg-slate-200 font-bold text-slate-700 hover:bg-slate-300"
            >
              −
            </button>
            <span className="w-6 text-center font-semibold">{line.quantity}</span>
            <button
              type="button"
              aria-label={`Agregar una unidad de ${line.name}`}
              disabled={disabled}
              onClick={() => onIncrement(line.productId)}
              className="h-11 w-11 rounded-full bg-slate-200 font-bold text-slate-700 hover:bg-slate-300"
            >
              +
            </button>
          </div>
          <button
            type="button"
            aria-label={`Eliminar ${line.name} del pedido`}
            disabled={disabled}
            onClick={() => onRemove(line.productId)}
            className="p-2 text-slate-400 hover:text-red-600"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  )
}
