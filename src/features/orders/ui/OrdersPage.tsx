import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { Spinner } from '../../../shared/ui/Spinner'
import { useAuth } from '../../auth/ui/AuthContext'
import type { Category, Product } from '../../products/domain/product'
import { listCategories, listProducts } from '../../products/infrastructure/productsRepository'
import { ProductGrid } from '../../sales/ui/ProductGrid'
import {
  MAX_CUSTOMER_NAME_LENGTH,
  TABLE_NUMBERS,
  isValidCustomerName,
  normalizeCustomerName,
  tableLabel,
  type Order,
} from '../domain/order'
import {
  addToDraft,
  decrementDraftLine,
  draftItemCount,
  draftToPayload,
  incrementDraftLine,
  removeDraftLine,
  type DraftLine,
} from '../domain/orderDraft'
import { addOrderItems, cancelOrder, createOrder, listOpenOrders } from '../infrastructure/ordersRepository'
import { OpenOrdersList } from './OpenOrdersList'
import { OrderFab } from './OrderFab'
import { OrderDraftPanel } from './OrderDraftPanel'
import { TableSelector } from './TableSelector'

export function OrdersPage() {
  const { profile } = useAuth()
  const nameId = useId()
  const filterId = useId()
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [tableNumber, setTableNumber] = useState<number | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [draft, setDraft] = useState<DraftLine[]>([])
  const [addingToOrder, setAddingToOrder] = useState<Order | null>(null)
  const [orderToCancel, setOrderToCancel] = useState<Order | null>(null)
  const [filterTable, setFilterTable] = useState<number | null>(null)
  const pending = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDraftOpen, setIsDraftOpen] = useState(false)

  const reloadOrders = useCallback(async () => {
    try {
      setOrders(await listOpenOrders())
      setActionError(null)
    } catch (error) {
      setActionError(toUserMessage(error))
    }
  }, [])

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const [loadedCategories, loadedProducts, loadedOrders] = await Promise.all([
          listCategories(),
          listProducts(true),
          listOpenOrders(),
        ])
        setCategories(loadedCategories)
        setProducts(loadedProducts)
        setOrders(loadedOrders)
      } catch (error) {
        setLoadError(toUserMessage(error))
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [])

  /** Runs a server action behind the pending guard; returns whether it succeeded. */
  async function runGuarded(action: () => Promise<void>): Promise<boolean> {
    if (pending.current) return false
    pending.current = true
    setIsSubmitting(true)
    setMessage(null)
    setActionError(null)
    try {
      await action()
      return true
    } catch (error) {
      setActionError(toUserMessage(error))
      return false
    } finally {
      pending.current = false
      setIsSubmitting(false)
    }
  }

  function updateDraft(update: (current: DraftLine[]) => DraftLine[]) {
    if (pending.current) return
    setMessage(null)
    setDraft(update)
  }

  function handleSelectProduct(product: Product) {
    updateDraft((current) => addToDraft(current, { productId: product.id, name: product.name }))
  }

  const canSubmit = draft.length > 0 && (addingToOrder !== null || (tableNumber !== null && isValidCustomerName(customerName)))

  async function handleSubmit(event: { preventDefault: () => void }) {
    event.preventDefault()
    if (!canSubmit || pending.current) return
    const items = draftToPayload(draft)
    const succeeded = await runGuarded(async () => {
      if (addingToOrder) {
        await addOrderItems(addingToOrder.id, items)
      } else if (tableNumber !== null) {
        await createOrder(tableNumber, normalizeCustomerName(customerName), items)
      }
    })
    if (!succeeded) return
    setMessage(addingToOrder ? 'Productos agregados al pedido.' : 'Pedido registrado correctamente.')
    setDraft([])
    setIsDraftOpen(false)
    setAddingToOrder(null)
    if (!addingToOrder) {
      setCustomerName('')
      setTableNumber(null)
    }
    await reloadOrders()
  }

  async function handleConfirmCancel() {
    if (!orderToCancel) return
    const order = orderToCancel
    setOrderToCancel(null)
    const succeeded = await runGuarded(async () => {
      await cancelOrder(order.id)
    })
    if (!succeeded) return
    if (addingToOrder?.id === order.id) {
      setAddingToOrder(null)
      setDraft([])
    }
    setMessage('Pedido cancelado.')
    await reloadOrders()
  }

  function handleStartAdding(order: Order) {
    if (pending.current) return
    setMessage(null)
    setDraft([])
    setAddingToOrder(order)
  }

  function handleExitAdding() {
    if (pending.current) return
    setIsDraftOpen(false)
    setAddingToOrder(null)
    setDraft([])
  }

  if (isLoading) {
    return <Spinner label="Cargando pedidos…" className="min-h-dvh" />
  }

  if (loadError) {
    return (
      <div className="p-4">
        <ErrorBanner message={loadError} />
      </div>
    )
  }

  const draftForm = (
    <form onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-bold text-slate-900">
        {addingToOrder
          ? `Agregar al pedido de ${addingToOrder.customerName} (${tableLabel(addingToOrder.tableNumber)})`
          : 'Nuevo pedido'}
      </h2>
      <OrderDraftPanel
        draft={draft}
        disabled={isSubmitting}
        onIncrement={(id) => updateDraft((c) => incrementDraftLine(c, id))}
        onDecrement={(id) => updateDraft((c) => decrementDraftLine(c, id))}
        onRemove={(id) => updateDraft((c) => removeDraftLine(c, id))}
      />
      {actionError && <ErrorBanner message={actionError} />}
      <Button type="submit" size="lg" disabled={!canSubmit || isSubmitting}>
        {isSubmitting ? 'Procesando…' : addingToOrder ? 'Agregar al pedido' : 'Registrar pedido'}
      </Button>
      {addingToOrder && (
        <Button type="button" variant="secondary" disabled={isSubmitting} onClick={handleExitAdding}>
          Cancelar edición
        </Button>
      )}
    </form>
  )

  const visibleOrders = filterTable === null ? orders : orders.filter((order) => order.tableNumber === filterTable)

  return (
    <div className="flex min-w-0 flex-col gap-8 p-4">
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {message && (
            <div
              role="status"
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
            >
              {message}
            </div>
          )}
          {addingToOrder === null && (
            <>
              <TableSelector selected={tableNumber} onSelect={setTableNumber} disabled={isSubmitting} />
              <Input
                id={nameId}
                label="Nombre del cliente"
                value={customerName}
                maxLength={MAX_CUSTOMER_NAME_LENGTH}
                disabled={isSubmitting}
                onChange={(event) => setCustomerName(event.target.value)}
              />
            </>
          )}
          <ProductGrid
            categories={categories}
            products={products}
            cartProductIds={new Set(draft.map((line) => line.productId))}
            onSelectProduct={handleSelectProduct}
            disabled={isSubmitting}
            showPrices={false}
          />
        </div>

        <div className="hidden min-w-0 lg:block">{draftForm}</div>
      </div>

      <section className="flex min-w-0 flex-col gap-4" aria-labelledby={`${filterId}-title`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id={`${filterId}-title`} className="text-xl font-bold text-slate-900">
            Pedidos abiertos
          </h2>
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={filterId} className="text-sm font-medium text-slate-700">
                Filtrar por mesa
              </label>
              <select
                id={filterId}
                value={filterTable ?? ''}
                onChange={(event) => setFilterTable(event.target.value === '' ? null : Number(event.target.value))}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900"
              >
                <option value="">Todas</option>
                {TABLE_NUMBERS.map((n) => (
                  <option key={n} value={n}>
                    {tableLabel(n)}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="secondary" disabled={isSubmitting} onClick={() => void reloadOrders()}>
              Actualizar
            </Button>
          </div>
        </div>
        <OpenOrdersList
          orders={visibleOrders}
          canCharge={profile?.role !== 'waiter'}
          disabled={isSubmitting}
          onAddItems={handleStartAdding}
          onCancel={setOrderToCancel}
        />
      </section>

      {(draft.length > 0 || addingToOrder !== null) && (
        <OrderFab itemCount={draftItemCount(draft)} onOpen={() => setIsDraftOpen(true)} />
      )}
      {isDraftOpen && (
        <Modal title="Pedido" onClose={() => setIsDraftOpen(false)}>
          {draftForm}
        </Modal>
      )}

      {orderToCancel && (
        <Modal title="Cancelar pedido" onClose={() => setOrderToCancel(null)}>
          <div className="flex flex-col gap-4">
            <p className="text-slate-700">
              ¿Cancelar el pedido de {orderToCancel.customerName} ({tableLabel(orderToCancel.tableNumber)})?
            </p>
            <Button variant="danger" onClick={() => void handleConfirmCancel()}>
              Sí, cancelar pedido
            </Button>
            <Button variant="secondary" onClick={() => setOrderToCancel(null)}>
              Volver
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
