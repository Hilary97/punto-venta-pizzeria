import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Input } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { Textarea } from '../../../shared/ui/Textarea'
import { Spinner } from '../../../shared/ui/Spinner'
import type { PizzaCatalog } from '../../pizza/domain/pizza'
import { PizzaBuilderModal, type BuiltPizza } from '../../pizza/ui/PizzaBuilderModal'
import type { Category, Product } from '../../products/domain/product'
import { ProductGrid } from '../../sales/ui/ProductGrid'
import type { WaiterShift } from '../../waiters/domain/waiter'
import {
  MAX_CUSTOMER_NAME_LENGTH,
  MAX_ORDER_NOTES_LENGTH,
  TABLE_NUMBERS,
  canRegisterOrder,
  normalizeCustomerName,
  normalizeNotes,
  orderLabel,
  tableLabel,
  type Order,
} from '../domain/order'
import {
  addPizzaToDraft,
  addToDraft,
  decrementDraftLine,
  draftItemCount,
  draftToPayload,
  incrementDraftLine,
  removeDraftLine,
  setDraftLineNotes,
  type DraftLine,
} from '../domain/orderDraft'
import { hideLegacyPizza } from '../domain/legacyPizza'
import type { OrdersSource } from '../domain/ordersSource'
import { AddingToOrderBar } from './AddingToOrderBar'
import { OpenOrdersList } from './OpenOrdersList'
import { OrderFab } from './OrderFab'
import { OrderDraftPanel } from './OrderDraftPanel'
import { TableSelector } from './TableSelector'
import { VariantPickerModal } from './VariantPickerModal'

interface OrdersWorkspaceProps {
  source: OrdersSource
  /** Active shift on authorized devices; omitted for admin/cashier. */
  shift?: WaiterShift
  canCharge: boolean
  onChangeWaiter?: () => void
  onShiftExpired?: () => void
}

/** Matches the server messages for a missing or expired waiter shift. */
function isShiftError(error: unknown): boolean {
  const message = toUserMessage(error)
  return message.includes('turno') || message.includes('PIN')
}

export function OrdersWorkspace({ source, shift, canCharge, onChangeWaiter, onShiftExpired }: OrdersWorkspaceProps) {
  const nameId = useId()
  const filterId = useId()
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [pizzaCatalog, setPizzaCatalog] = useState<PizzaCatalog | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [tableNumber, setTableNumber] = useState<number | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [orderNotes, setOrderNotes] = useState('')
  const [isBuilderOpen, setIsBuilderOpen] = useState(false)
  const [notesOrder, setNotesOrder] = useState<Order | null>(null)
  const [notesText, setNotesText] = useState('')
  const [notesError, setNotesError] = useState<string | null>(null)
  const lineSeq = useRef(0)
  const [draft, setDraft] = useState<DraftLine[]>([])
  const [addingToOrder, setAddingToOrder] = useState<Order | null>(null)
  const [orderToCancel, setOrderToCancel] = useState<Order | null>(null)
  const [filterTable, setFilterTable] = useState<number | null>(null)
  const pending = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDraftOpen, setIsDraftOpen] = useState(false)
  const [variantProduct, setVariantProduct] = useState<Product | null>(null)
  const builderRef = useRef<HTMLDivElement>(null)
  const addingToOrderId = addingToOrder?.id ?? null

  // Bring the builder into view so the waiter sees they are adding to an open order.
  useEffect(() => {
    if (addingToOrderId === null) return
    builderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [addingToOrderId])

  const reloadOrders = useCallback(async () => {
    try {
      setOrders(await source.listOpenOrders())
      setActionError(null)
    } catch (error) {
      setActionError(toUserMessage(error))
    }
  }, [source])

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const [catalog, loadedOrders] = await Promise.all([source.loadCatalog(), source.listOpenOrders()])
        setCategories(catalog.categories)
        setProducts(catalog.products)
        setPizzaCatalog(catalog.pizza)
        setOrders(loadedOrders)
      } catch (error) {
        setLoadError(toUserMessage(error))
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [source])

  /** Runs a server action behind the pending guard; returns whether it succeeded. */
  async function runGuarded(action: () => Promise<void>, onError?: (message: string) => void): Promise<boolean> {
    if (pending.current) return false
    pending.current = true
    setIsSubmitting(true)
    setMessage(null)
    setActionError(null)
    try {
      await action()
      return true
    } catch (error) {
      if (shift && isShiftError(error)) {
        onShiftExpired?.()
        return false
      }
      const text = toUserMessage(error)
      if (onError) onError(text)
      else setActionError(text)
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

  function nextLineId(): string {
    lineSeq.current += 1
    return `line-${lineSeq.current}`
  }

  function handleSelectProduct(product: Product) {
    if (product.variants.length > 0) {
      setVariantProduct(product)
      return
    }
    addProduct(product, null)
  }

  function addProduct(product: Product, variant: string | null) {
    const lineId = nextLineId()
    updateDraft((current) => addToDraft(current, { lineId, productId: product.id, name: product.name, variant }))
  }

  function handleAddPizza(pizza: BuiltPizza) {
    const lineId = nextLineId()
    updateDraft((current) => addPizzaToDraft(current, { lineId, pizza: pizza.config, name: pizza.name, notes: pizza.notes }))
    setIsBuilderOpen(false)
  }

  function handleEditNotes(order: Order) {
    if (pending.current) return
    setNotesOrder(order)
    setNotesText(order.notes ?? '')
    setNotesError(null)
  }

  async function handleSaveNotes() {
    if (!notesOrder) return
    const order = notesOrder
    setNotesError(null)
    const succeeded = await runGuarded(async () => {
      await source.setOrderNotes(order.id, normalizeNotes(notesText))
    }, setNotesError)
    if (!succeeded) return
    setNotesOrder(null)
    setMessage('Nota actualizada.')
    await reloadOrders()
  }

  const canSubmit = draft.length > 0 && (addingToOrder !== null || canRegisterOrder(tableNumber, customerName))

  async function handleSubmit(event: { preventDefault: () => void }) {
    event.preventDefault()
    if (!canSubmit || pending.current) return
    const items = draftToPayload(draft)
    const succeeded = await runGuarded(async () => {
      if (addingToOrder) {
        await source.addOrderItems(addingToOrder.id, items)
      } else {
        await source.createOrder(tableNumber, normalizeCustomerName(customerName) || null, items, normalizeNotes(orderNotes))
      }
    })
    if (!succeeded) return
    setMessage(addingToOrder ? 'Productos agregados al pedido.' : 'Pedido registrado correctamente.')
    setDraft([])
    setIsDraftOpen(false)
    setAddingToOrder(null)
    if (!addingToOrder) {
      setCustomerName('')
      setOrderNotes('')
      setTableNumber(null)
    }
    await reloadOrders()
  }

  async function handleConfirmCancel() {
    if (!orderToCancel) return
    const order = orderToCancel
    setOrderToCancel(null)
    const succeeded = await runGuarded(async () => {
      await source.cancelOrder(order.id)
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
          ? `Agregar al pedido ${orderLabel(addingToOrder)}`
          : 'Nuevo pedido'}
      </h2>
      <OrderDraftPanel
        draft={draft}
        disabled={isSubmitting}
        onIncrement={(id) => updateDraft((c) => incrementDraftLine(c, id))}
        onDecrement={(id) => updateDraft((c) => decrementDraftLine(c, id))}
        onRemove={(id) => updateDraft((c) => removeDraftLine(c, id))}
        onNotesChange={(id, notes) => updateDraft((c) => setDraftLineNotes(c, id, notes))}
      />
      {!addingToOrder && (
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Nota del pedido (opcional)
          <Textarea
            value={orderNotes}
            maxLength={MAX_ORDER_NOTES_LENGTH}
            disabled={isSubmitting}
            onChange={(event) => setOrderNotes(event.target.value)}
          />
        </label>
      )}
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

  const legacyHidden = hideLegacyPizza(categories, products)
  const hasPizzaBuilder = pizzaCatalog !== null && pizzaCatalog.sizes.length > 0
  const visibleOrders = filterTable === null ? orders : orders.filter((order) => order.tableNumber === filterTable)

  const openOrdersSection = (
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
        canCharge={canCharge}
        disabled={isSubmitting}
        onAddItems={handleStartAdding}
        onCancel={setOrderToCancel}
        onEditNotes={handleEditNotes}
      />
    </section>
  )

  return (
    <div className="flex min-w-0 flex-col gap-8 p-4 pb-28">
      {shift && onChangeWaiter && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="break-words font-semibold text-slate-900">Mesero: {shift.fullName}</p>
          <Button variant="secondary" disabled={isSubmitting} onClick={onChangeWaiter}>
            Cambiar mesero
          </Button>
        </div>
      )}
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
          <div ref={builderRef} className="flex min-w-0 scroll-mt-4 flex-col gap-4">
            {hasPizzaBuilder && (
              <Button size="lg" disabled={isSubmitting} onClick={() => setIsBuilderOpen(true)}>
                Armar pizza
              </Button>
            )}
            <ProductGrid
              categories={legacyHidden.categories}
              products={legacyHidden.products}
              cartProductIds={new Set(draft.flatMap((line) => (line.kind === 'product' ? [line.productId] : [])))}
              onSelectProduct={handleSelectProduct}
              disabled={isSubmitting}
              showPrices={false}
              allContent={openOrdersSection}
              allContentLabel="Pedidos abiertos"
              stickyHeader={addingToOrder && (
                <AddingToOrderBar order={addingToOrder} disabled={isSubmitting} onCancel={handleExitAdding} />
              )}
            />
          </div>
        </div>

        <div className="hidden min-w-0 lg:block">{draftForm}</div>
      </div>

      {(draft.length > 0 || addingToOrder !== null) && (
        <OrderFab
          itemCount={draftItemCount(draft)}
          targetLabel={addingToOrder ? orderLabel(addingToOrder) : null}
          onOpen={() => setIsDraftOpen(true)}
        />
      )}
      {isDraftOpen && (
        <Modal title="Pedido" onClose={() => setIsDraftOpen(false)}>
          {draftForm}
        </Modal>
      )}

      {variantProduct && (
        <VariantPickerModal
          productName={variantProduct.name}
          variants={variantProduct.variants}
          onPick={(variant) => {
            addProduct(variantProduct, variant)
            setVariantProduct(null)
          }}
          onClose={() => setVariantProduct(null)}
        />
      )}

      {isBuilderOpen && pizzaCatalog && (
        <PizzaBuilderModal catalog={pizzaCatalog} onAdd={handleAddPizza} onClose={() => setIsBuilderOpen(false)} />
      )}

      {notesOrder && (
        <Modal title={`Nota del pedido ${orderLabel(notesOrder)}`} onClose={() => setNotesOrder(null)}>
          <div className="flex flex-col gap-4">
            <Textarea
              aria-label="Nota del pedido"
              value={notesText}
              maxLength={MAX_ORDER_NOTES_LENGTH}
              onChange={(event) => setNotesText(event.target.value)}
            />
            {notesError && <ErrorBanner message={notesError} />}
            <Button disabled={isSubmitting} onClick={() => void handleSaveNotes()}>
              Guardar nota
            </Button>
            <Button variant="secondary" onClick={() => setNotesOrder(null)}>
              Volver
            </Button>
          </div>
        </Modal>
      )}

      {orderToCancel && (
        <Modal title="Cancelar pedido" onClose={() => setOrderToCancel(null)}>
          <div className="flex flex-col gap-4">
            <p className="text-slate-700">
              ¿Cancelar el pedido {orderLabel(orderToCancel)}?
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
