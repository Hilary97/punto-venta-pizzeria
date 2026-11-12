import { useEffect, useRef, useState } from 'react'
import { ChargedScreen, type ChargedSale } from './ChargedScreen'
import { Link, useSearchParams } from 'react-router'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { MoneyText } from '../../../shared/ui/MoneyText'
import { Spinner } from '../../../shared/ui/Spinner'
import { toUserMessage } from '../../../shared/errors'
import { orderLabel, type Order } from '../../orders/domain/order'
import type { OrderQuote } from '../../orders/domain/orderQuote'
import { getOrder, payOrder, quoteOrder } from '../../orders/infrastructure/ordersRepository'
import { CheckoutForm } from './CheckoutForm'
import { PendingOrdersPanel } from './PendingOrdersPanel'
import { QuoteLinesPanel } from './QuoteLinesPanel'

const ORDER_PARAM = 'pedido'

const backToOrdersLinkClass = 'font-semibold text-emerald-700 underline hover:text-emerald-800'

export function PosPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const orderId = searchParams.get(ORDER_PARAM)
  const [loadedOrder, setOrder] = useState<Order | null>(null)
  const [quote, setQuote] = useState<OrderQuote | null>(null)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const pending = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastSale, setLastSale] = useState<ChargedSale | null>(null)

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const fetchedOrder = orderId ? await getOrder(orderId) : null
        // Quote only open orders: the RPC is meant for payable ones and a missing order has nothing to quote.
        const fetchedQuote = orderId && fetchedOrder?.status === 'open' ? await quoteOrder(orderId) : null
        if (cancelled) return
        setOrder(null)
        setQuote(null)
        setOrderError(null)
        if (orderId) {
          if (!fetchedOrder) {
            setOrderError('No se encontró el pedido.')
          } else if (fetchedOrder.status !== 'open' || !fetchedQuote || fetchedQuote.status !== 'open') {
            setOrderError('El pedido ya no está abierto, por lo que no se puede cobrar.')
          } else if (!fetchedQuote.payable) {
            const unavailable = fetchedQuote.lines
              .filter((line) => !line.available)
              .map((line) => (line.reason ? `${line.name}: ${line.reason}` : line.name))
            setOrderError(`No se puede cobrar: productos no disponibles en el pedido (${unavailable.join(', ')}). Edita el pedido en Pedidos.`)
          } else {
            setOrder(fetchedOrder)
            setQuote(fetchedQuote)
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
    setLastSale(null)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set(ORDER_PARAM, id)
      return next
    })
  }

  async function handleConfirmSale(receivedCents: number) {
    if (pending.current || !order || !quote || quote.lines.length === 0 || !Number.isSafeInteger(receivedCents) || receivedCents < quote.totalCents) return
    pending.current = true
    setIsSubmitting(true)
    try {
      const result = await payOrder(order.id, receivedCents)
      setLastSale({ label: orderLabel(order), totalCents: result.totalCents, changeCents: result.changeCents })
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

  const chargedScreen = lastSale && <ChargedScreen sale={lastSale} onDone={() => setLastSale(null)} />

  if (!order || !quote) {
    return (
      <div className="flex min-w-0 flex-col gap-4 p-4">
        {chargedScreen}
        <PendingOrdersPanel onCharge={chargeOrder} />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4">
      {/* Narrow screens: title on its own row, actions below it on one row. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="order-first min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-auto">
          <h1 className="break-words text-lg font-bold text-slate-900">{`Cobrar ${orderLabel(order)}`}</h1>
          {order.waiterName && <p className="text-sm text-slate-600">{`Atendió ${order.waiterName}`}</p>}
        </div>
        <Link to="/pedidos" aria-label="Volver a pedidos" className="inline-flex min-h-12 items-center rounded-lg bg-slate-100 px-4 font-bold text-slate-900 hover:bg-slate-200 sm:order-first">
          <span aria-hidden="true" className="mr-1">←</span>
          <span className="sm:hidden">Pedidos</span>
          <span className="hidden sm:inline">Volver a pedidos</span>
        </Link>
        <button type="button" disabled={isSubmitting} onClick={clearOrderParam}
          className="ml-auto min-h-12 rounded-lg border border-red-300 bg-white px-4 font-bold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/60">
          Descartar
        </button>
      </header>
      {/* Payment comes first in the DOM so phones reach the keypad and Cobrar without scrolling past the order; md+ shows it on the right. */}
      <div className="grid min-w-0 items-start gap-4 md:grid-cols-2">
        <section aria-label="Cobro" className="flex min-w-0 flex-col gap-3 md:col-start-2 md:row-start-1">
          <p className="flex items-baseline justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 md:hidden">
            <span className="font-bold text-slate-600">Total a cobrar</span>
            <MoneyText cents={quote.totalCents} className="text-2xl font-extrabold text-slate-900" />
          </p>
          <CheckoutForm totalCents={quote.totalCents} isEmpty={quote.lines.length === 0} isSubmitting={isSubmitting} onConfirm={handleConfirmSale} />
        </section>
        <section aria-label="Productos del pedido" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 md:col-start-1 md:row-start-1">
          <QuoteLinesPanel quote={quote} orderNotes={order.notes} />
        </section>
      </div>
    </div>
  )
}
