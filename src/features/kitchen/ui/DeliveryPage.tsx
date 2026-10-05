import { authenticatedDeliverySource } from '../infrastructure/kitchenRepository'
import { DeliveryBoard } from './DeliveryBoard'

/** Admin/cashier delivery view. */
export function DeliveryPage() {
  return <DeliveryBoard source={authenticatedDeliverySource} />
}
