import { authenticatedOrdersSource } from '../infrastructure/ordersSources'
import { OrdersWorkspace } from './OrdersWorkspace'

/** Orders for a signed-in admin or cashier: no waiter gate, and orders can be charged. */
export function OrdersPage() {
  return <OrdersWorkspace source={authenticatedOrdersSource} canCharge />
}
