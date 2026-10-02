import { cn } from '../../../shared/ui/cn'
import { TABLE_NUMBERS, tableLabel } from '../domain/order'

interface TableSelectorProps {
  selected: number | null
  onSelect: (tableNumber: number) => void
  disabled?: boolean
}

export function TableSelector({ selected, onSelect, disabled = false }: TableSelectorProps) {
  return (
    <div role="group" aria-label="Mesa" className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
      {TABLE_NUMBERS.map((tableNumber) => {
        const isSelected = tableNumber === selected
        return (
          <button
            key={tableNumber}
            type="button"
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => onSelect(tableNumber)}
            className={cn(
              'min-h-14 rounded-xl text-lg font-bold transition-colors disabled:opacity-50',
              isSelected ? 'bg-red-700 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300',
            )}
          >
            {tableLabel(tableNumber)}
          </button>
        )
      })}
    </div>
  )
}
