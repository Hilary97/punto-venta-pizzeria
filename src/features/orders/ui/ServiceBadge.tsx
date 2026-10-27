import { cn } from '../../../shared/ui/cn'
import { serviceLabel, type OrderService } from '../domain/order'

interface ServiceBadgeProps {
  service: OrderService | null | undefined
  /** Text size classes; the kitchen passes bigger ones. */
  className?: string
}

/** Dine-in or takeaway label of an order; renders nothing for orders without one. */
export function ServiceBadge({ service, className = 'text-lg' }: ServiceBadgeProps) {
  if (!service) return null
  return (
    <p
      className={cn(
        'self-start rounded-lg border-2 px-3 py-1 font-bold',
        service === 'takeaway'
          ? 'border-violet-600 bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100'
          : 'border-teal-600 bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-100',
        className,
      )}
    >
      {serviceLabel(service)}
    </p>
  )
}
