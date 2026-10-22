import { cn } from '../../../shared/ui/cn'
import { serviceLabel, type OrderService } from '../domain/order'

const SERVICES: readonly OrderService[] = ['dine_in', 'takeaway']

interface ServiceSelectorProps {
  selected: OrderService | null
  onSelect: (service: OrderService | null) => void
  disabled?: boolean
}

export function ServiceSelector({ selected, onSelect, disabled = false }: ServiceSelectorProps) {
  return (
    <div role="group" aria-label="Tipo de pedido" className="grid grid-cols-2 gap-3">
      {SERVICES.map((service) => {
        const isSelected = service === selected
        return (
          <button
            key={service}
            type="button"
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => onSelect(isSelected ? null : service)}
            className={cn(
              'min-h-14 rounded-xl text-lg font-bold transition-colors disabled:opacity-50',
              isSelected ? 'bg-red-700 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300',
            )}
          >
            {serviceLabel(service)}
          </button>
        )
      })}
    </div>
  )
}
