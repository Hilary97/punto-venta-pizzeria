import { authenticatedDeliverySource } from '../infrastructure/kitchenRepository'
import { DeliveryBoard } from './DeliveryBoard'

/** Admin/cashier delivery view, split into one section per pickup place. */
export function DeliveryPage() {
  return <DeliveryBoard source={authenticatedDeliverySource} sectioned />
}
