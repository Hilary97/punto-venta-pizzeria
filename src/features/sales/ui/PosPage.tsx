import { useEffect, useRef, useState } from 'react'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import { toUserMessage } from '../../../shared/errors'
import { formatMoney } from '../../../shared/money'
import type { Category, Product } from '../../products/domain/product'
import { listCategories, listProducts } from '../../products/infrastructure/productsRepository'
import { addItemToCart, cartTotalCents, decrementItemInCart, incrementItemInCart, removeItemFromCart } from '../domain/cart'
import type { CartItem } from '../domain/cart'
import { createSale } from '../infrastructure/salesRepository'
import { CartPanel } from './CartPanel'
import { CheckoutForm } from './CheckoutForm'
import { ProductGrid } from './ProductGrid'

export function PosPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
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
        const [loadedCategories, loadedProducts] = await Promise.all([listCategories(), listProducts(true)])
        setCategories(loadedCategories)
        setProducts(loadedProducts)
      } catch (error) {
        setLoadError(toUserMessage(error))
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [])

  function handleSelectProduct(product: Product) {
    if (pending.current) return
    setLastSaleMessage(null)
    setCart((current) =>
      addItemToCart(current, { productId: product.id, name: product.name, unitPriceCents: product.priceCents }),
    )
  }

  function updateCart(update: (current: CartItem[]) => CartItem[]) {
    if (pending.current) return
    setLastSaleMessage(null)
    setCart(update)
  }

  async function handleConfirmSale(receivedCents: number) {
    if (pending.current || cart.length === 0 || !Number.isSafeInteger(receivedCents) || receivedCents < cartTotalCents(cart)) return
    pending.current = true
    setIsSubmitting(true)
    try {
      const result = await createSale(
        cart.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        receivedCents,
      )
      setCart([])
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

  const total = cartTotalCents(cart)

  return (
    <div className="grid min-w-0 gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <div className="min-w-0">
        {lastSaleMessage && (
          <div
            role="status"
            className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          >
            {lastSaleMessage}
          </div>
        )}
        <ProductGrid categories={categories} products={products} onSelectProduct={handleSelectProduct} disabled={isSubmitting} />
      </div>

      <div className="flex min-w-0 flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <CartPanel
          cart={cart}
          onIncrement={(id) => updateCart((c) => incrementItemInCart(c, id))}
          onDecrement={(id) => updateCart((c) => decrementItemInCart(c, id))}
          onRemove={(id) => updateCart((c) => removeItemFromCart(c, id))}
          disabled={isSubmitting}
        />
        <CheckoutForm totalCents={total} isEmpty={cart.length === 0} isSubmitting={isSubmitting} onConfirm={handleConfirmSale} />
      </div>
    </div>
  )
}
