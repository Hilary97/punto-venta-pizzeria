import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import { toUserMessage } from '../../../shared/errors'
import { formatMoney } from '../../../shared/money'
import { orderLabel, type Order } from '../../orders/domain/order'
import { getOrder, payOrder } from '../../orders/infrastructure/ordersRepository'
import { listProducts } from '../../products/infrastructure/productsRepository'
import { cartTotalCents, type CartItem } from '../domain/cart'
import { buildOrderCart } from '../domain/orderCart'
import { CartPanel } from './CartPanel'
import { CheckoutForm } from './CheckoutForm'
import { PendingOrdersPanel } from './PendingOrdersPanel'

const ORDER_PARAM = 'pedido'

const backToOrdersLinkClass = 'font-semibold text-emerald-700 underline hover:text-emerald-800'

export function PosPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const orderId = searchParams.get(ORDER_PARAM)
  const [loadedOrder, setOrder] = useState<Order | null>(null)
  const [orderCart, setOrderCart] = useState<CartItem[]>([])
  const [orderError, setOrderError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const pending = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastSaleMessage, setLastSaleMessage] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const [loadedProducts, fetchedOrder] = await Promise.all([
          orderId ? listProducts(true) : Promise.resolve([]),
          orderId ? getOrder(orderId) : Promise.resolve(null),
        ])
        if (cancelled) return
        setOrder(null)
        setOrderCart([])
        setOrderError(null)
        if (orderId) {
          const built = fetchedOrder ? buildOrderCart(fetchedOrder.items, loadedProducts) : null
          if (!fetchedOrder) {
            setOrderError('No se encontró el pedido.')
          } else if (fetchedOrder.status !== 'open') {
            setOrderError('El pedido ya no está abierto, por lo que no se puede cobrar.')
          } else if (built && built.unavailable.length > 0) {
            setOrderError(`No se puede cobrar: productos no disponibles en el pedido (${built.unavailable.join(', ')}). Edita el pedido en Pedidos.`)
          } else if (built) {
            setOrder(fetchedOrder)
            setOrderCart(built.items)
          }
        }
      } catch (error) {
        if (!cancelled) setLoadError(toUserMessage(error))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    let cancelled = false
    void load()
    return () => {
      cancelled = true
    }
  }, [orderId])

  const isOrderMode = orderId !== null
  const order = isOrderMode ? loadedOrder : null

  function clearOrderParam() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete(ORDER_PARAM)
      return next
    })
  }

  function chargeOrder(id: string) {
    setLastSaleMessage(null)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set(ORDER_PARAM, id)
      return next
    })
  }

  async function handleConfirmSale(receivedCents: number) {
    if (pending.current || !order || orderCart.length === 0 || !Number.isSafeInteger(receivedCents) || receivedCents < cartTotalCents(orderCart)) return
    pending.current = true
    setIsSubmitting(true)
    try {
      const result = await payOrder(order.id, receivedCents)
      setLastSaleMessage(`Pedido ${orderLabel(order)} cobrado. Total cobrado: ${formatMoney(result.totalCents)}. Cambio: ${formatMoney(result.changeCents)}.`)
      clearOrderParam()
    } finally {
      pending.current = false
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return <Spinner label="Cargando…" className="min-h-dvh" />
  }

  if (loadError) {
    return (
      <div className="p-4">
        <ErrorBanner message={loadError} />
      </div>
    )
  }

  if (isOrderMode && !order) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <ErrorBanner message={orderError ?? 'No se pudo cargar el pedido.'} />
        <Link to="/pedidos" className={backToOrdersLinkClass}>
          Volver a pedidos
        </Link>
      </div>
    )
  }

  const successMessage = lastSaleMessage && (
    <div
      role="status"
      className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
    >
      {lastSaleMessage}
    </div>
  )

  if (!order) {
    return (
      <div className="flex min-w-0 flex-col gap-4 p-4">
        {successMessage}
        <PendingOrdersPanel onCharge={chargeOrder} />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">{`Cobrando pedido ${orderLabel(order)}${order.waiterName ? ` · Atendió ${order.waiterName}` : ''}`}</p>
        <div className="flex items-center gap-4">
          <Link to="/pedidos" className={backToOrdersLinkClass}>
            Volver a pedidos
          </Link>
          <button type="button" disabled={isSubmitting} onClick={clearOrderParam} className={backToOrdersLinkClass}>
            Descartar
          </button>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <CartPanel cart={orderCart} readOnly disabled={isSubmitting} />
        <CheckoutForm totalCents={cartTotalCents(orderCart)} isEmpty={orderCart.length === 0} isSubmitting={isSubmitting} onConfirm={handleConfirmSale} />
      </div>
    </div>
  )
}
