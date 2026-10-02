import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Modal } from '../../../shared/ui/Modal'
import { Spinner } from '../../../shared/ui/Spinner'
import { toUserMessage } from '../../../shared/errors'
import { formatMoney } from '../../../shared/money'
import { orderLabel, type Order } from '../../orders/domain/order'
import { getOrder, payOrder } from '../../orders/infrastructure/ordersRepository'
import type { Category, Product } from '../../products/domain/product'
import { listCategories, listProducts } from '../../products/infrastructure/productsRepository'
import { addItemToCart, cartItemCount, cartTotalCents, decrementItemInCart, incrementItemInCart, removeItemFromCart } from '../domain/cart'
import type { CartItem } from '../domain/cart'
import { buildOrderCart } from '../domain/orderCart'
import { createSale } from '../infrastructure/salesRepository'
import { CartFab } from './CartFab'
import { CartPanel } from './CartPanel'
import { CheckoutForm } from './CheckoutForm'
import { PendingOrdersBar } from './PendingOrdersBar'
import { ProductGrid } from './ProductGrid'

const ORDER_PARAM = 'pedido'

const backToOrdersLinkClass = 'font-semibold text-emerald-700 underline hover:text-emerald-800'

export function PosPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const orderId = searchParams.get(ORDER_PARAM)
  const [loadedOrder, setOrder] = useState<Order | null>(null)
  const [orderCart, setOrderCart] = useState<CartItem[]>([])
  const [orderError, setOrderError] = useState<string | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const pending = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastSaleMessage, setLastSaleMessage] = useState<string | null>(null)
  const [isCartOpen, setIsCartOpen] = useState(false)

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const [loadedCategories, loadedProducts, fetchedOrder] = await Promise.all([
          listCategories(),
          listProducts(true),
          orderId ? getOrder(orderId) : Promise.resolve(null),
        ])
        if (cancelled) return
        setCategories(loadedCategories)
        setProducts(loadedProducts)
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
  const activeCart = isOrderMode ? orderCart : cart

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

  function handleSelectProduct(product: Product) {
    if (pending.current || isOrderMode) return
    setLastSaleMessage(null)
    setCart((current) =>
      addItemToCart(current, { productId: product.id, name: product.name, unitPriceCents: product.priceCents }),
    )
  }

  function updateCart(update: (current: CartItem[]) => CartItem[]) {
    if (pending.current || isOrderMode) return
    setLastSaleMessage(null)
    setCart(update)
  }

  async function handleConfirmSale(receivedCents: number) {
    if (pending.current || activeCart.length === 0 || !Number.isSafeInteger(receivedCents) || receivedCents < cartTotalCents(activeCart)) return
    if (isOrderMode && !order) return
    pending.current = true
    setIsSubmitting(true)
    try {
      if (order) {
        const result = await payOrder(order.id, receivedCents)
        setIsCartOpen(false)
        setLastSaleMessage(`Pedido ${orderLabel(order)} cobrado. Total cobrado: ${formatMoney(result.totalCents)}. Cambio: ${formatMoney(result.changeCents)}.`)
        clearOrderParam()
        return
      }
      const result = await createSale(
        cart.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        receivedCents,
      )
      setCart([])
      setIsCartOpen(false)
      setLastSaleMessage(`Venta registrada correctamente. Total cobrado: ${formatMoney(result.totalCents)}. Cambio: ${formatMoney(result.changeCents)}.`)
    } finally {
      pending.current = false
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return <Spinner label="Cargando productos…" className="min-h-dvh" />
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

  const total = cartTotalCents(activeCart)

  return (
    <>
      <div className="grid min-w-0 gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="min-w-0">
          {order && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">{`Cobrando pedido ${orderLabel(order)}`}</p>
              <div className="flex items-center gap-4">
                <Link to="/pedidos" className={backToOrdersLinkClass}>
                  Volver a pedidos
                </Link>
                <button type="button" disabled={isSubmitting} onClick={clearOrderParam} className={backToOrdersLinkClass}>
                  Descartar
                </button>
              </div>
            </div>
          )}
          {lastSaleMessage && (
            <div
              role="status"
              className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
            >
              {lastSaleMessage}
            </div>
          )}
          {!isOrderMode && <PendingOrdersBar onCharge={chargeOrder} />}
          <ProductGrid
            categories={categories}
            products={products}
            cartProductIds={new Set(activeCart.map((item) => item.productId))}
            onSelectProduct={handleSelectProduct}
            disabled={isSubmitting || isOrderMode}
          />
        </div>

        <div className="hidden min-w-0 flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 lg:flex">
          <CartPanel
            cart={activeCart}
            readOnly={isOrderMode}
            onIncrement={(id) => updateCart((c) => incrementItemInCart(c, id))}
            onDecrement={(id) => updateCart((c) => decrementItemInCart(c, id))}
            onRemove={(id) => updateCart((c) => removeItemFromCart(c, id))}
            disabled={isSubmitting}
          />
          <CheckoutForm totalCents={total} isEmpty={activeCart.length === 0} isSubmitting={isSubmitting} onConfirm={handleConfirmSale} />
        </div>
      </div>

      {activeCart.length > 0 && (
        <CartFab itemCount={cartItemCount(activeCart)} totalCents={total} onOpen={() => setIsCartOpen(true)} />
      )}
      {isCartOpen && (
        <Modal title="Carrito" onClose={() => setIsCartOpen(false)}>
          <div className="flex flex-col gap-4">
            <CartPanel
              cart={activeCart}
            readOnly={isOrderMode}
              onIncrement={(id) => updateCart((c) => incrementItemInCart(c, id))}
              onDecrement={(id) => updateCart((c) => decrementItemInCart(c, id))}
              onRemove={(id) => updateCart((c) => removeItemFromCart(c, id))}
              disabled={isSubmitting}
            />
            <CheckoutForm totalCents={total} isEmpty={activeCart.length === 0} isSubmitting={isSubmitting} onConfirm={handleConfirmSale} />
          </div>
        </Modal>
      )}
    </>
  )
}
