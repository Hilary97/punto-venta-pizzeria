import { Input } from "../../../shared/ui/Input";
import { MAX_ITEM_NOTES_LENGTH, productLineLabel } from "../domain/order";
import type { DraftLine } from "../domain/orderDraft";

interface OrderDraftPanelProps {
  draft: DraftLine[];
  onIncrement: (lineId: string) => void;
  onDecrement: (lineId: string) => void;
  onRemove: (lineId: string) => void;
  onNotesChange: (lineId: string, notes: string) => void;
  disabled?: boolean;
}

export function OrderDraftPanel({
  draft,
  onIncrement,
  onDecrement,
  onRemove,
  onNotesChange,
  disabled = false,
}: OrderDraftPanelProps) {
  if (draft.length === 0) {
    return (
      <p className="text-center text-slate-500">Agrega productos al pedido.</p>
    );
  }

  return (
    <ul className="divide-y divide-slate-200">
      {draft.map((line) => {
        const label =
          line.kind === "product"
            ? productLineLabel(line.name, line.variant)
            : line.name;
        return (
          <li key={line.lineId} className="flex flex-col gap-2 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 break-words font-medium text-slate-900">
                {label}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Quitar una unidad de ${label}`}
                  disabled={disabled}
                  onClick={() => onDecrement(line.lineId)}
                  className="h-11 w-11 rounded-full bg-slate-200 font-bold text-slate-700 hover:bg-slate-300"
                >
                  −
                </button>
                <span className="w-6 text-center font-semibold">
                  {line.quantity}
                </span>
                <button
                  type="button"
                  aria-label={`Agregar una unidad de ${label}`}
                  disabled={disabled}
                  onClick={() => onIncrement(line.lineId)}
                  className="h-11 w-11 rounded-full bg-slate-200 font-bold text-slate-700 hover:bg-slate-300"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                aria-label={`Eliminar ${label} del pedido`}
                disabled={disabled}
                onClick={() => onRemove(line.lineId)}
                className="p-2 text-slate-400 hover:text-red-600"
              >
                ✕
              </button>
            </div>
            <Input
              aria-label={`Nota para ${label}`}
              placeholder="Nota (opcional)"
              value={line.notes}
              maxLength={MAX_ITEM_NOTES_LENGTH}
              disabled={disabled}
              onChange={(event) =>
                onNotesChange(line.lineId, event.target.value)
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
