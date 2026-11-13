import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { useChangeSignal } from '../../../shared/realtime/useChangeSignal'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Sheet } from '../../../shared/ui/Sheet'
import { Modal } from '../../../shared/ui/Modal'
import { Textarea } from '../../../shared/ui/Textarea'
import { Spinner } from '../../../shared/ui/Spinner'
import { cn } from '../../../shared/ui/cn'
import type { PizzaCatalog } from '../../pizza/domain/pizza'
import { PizzaBuilderModal, type BuiltPizza } from '../../pizza/ui/PizzaBuilderModal'
import type { Category, Product } from '../../products/domain/product'
import type { WaiterShift } from '../../waiters/domain/waiter'
import {
  MISSING_LABEL,
  MAX_ORDER_NOTES_LENGTH,
  PICKUP_TIME_ERROR,
  TABLE_NUMBERS,
  canRegisterOrder,
  missingForOrder,
  isFuturePickupTime,
  normalizeCustomerName,
  normalizeNotes,
  orderLabel,
  pickupTimeToIso,
  serviceLabel,
  tableLabel,
  type Order,
  type OrderService,
} from '../domain/order'
import {
  addPizzaToDraft,
  addToDraft,
  decrementDraftLine,
  removeProductFromDraft,
  draftItemCount,
  draftToPayload,
  pizzaQuantity,
  productQuantity,
  incrementDraftLine,
  removeDraftLine,
  restoreDraftLine,
  setDraftLineNotes,
  type DraftLine,
} from '../domain/orderDraft'
import { hideLegacyPizza } from '../domain/legacyPizza'
import { filterOrders, sortOrdersByName } from '../domain/orderFilter'
import type { OrdersSource } from '../domain/ordersSource'
import { tableOccupancy } from '../domain/tableOccupancy'
import { AddingToOrderBar } from './AddingToOrderBar'
import { OpenOrdersList } from './OpenOrdersList'
import { MesaStep } from './MesaStep'
import { OrderContextBar } from './OrderContextBar'
import { ProductsStep } from './ProductsStep'
import { ReviewStep } from './ReviewStep'
import { StepIndicator, type OrderStep } from './StepIndicator'

interface OrdersWorkspaceProps {
  source: OrdersSource
  /** Active shift on authorized devices; omitted for admin/cashier. */
  shift?: WaiterShift
  canCharge: boolean
  onChangeWaiter?: () => void
  onShiftExpired?: () => void
  /** Phones in the app layout have a bottom nav; fixed bars sit above it. Device apps have none. */
  aboveBottomNav?: boolean
}

/** Matches the server messages for a missing or expired waiter shift. */
function isShiftError(error: unknown): boolean {
  const message = toUserMessage(error)
  return message.includes('turno') || message.includes('PIN')
}

export function OrdersWorkspace({ source, shift, canCharge, onChangeWaiter, onShiftExpired, aboveBottomNav = false }: OrdersWorkspaceProps) {
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
  const [service, setService] = useState<OrderService | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [orderNotes, setOrderNotes] = useState('')
  const [pickupTime, setPickupTime] = useState('')
  const [isBuilderOpen, setIsBuilderOpen] = useState(false)
  const [notesOrder, setNotesOrder] = useState<Order | null>(null)
  const [notesText, setNotesText] = useState('')
  const [notesError, setNotesError] = useState<string | null>(null)
  const lineSeq = useRef(0)
  const [draft, setDraft] = useState<DraftLine[]>([])
  const [addingToOrder, setAddingToOrder] = useState<Order | null>(null)
  const [orderToCancel, setOrderToCancel] = useState<Order | null>(null)
  const [filterTable, setFilterTable] = useState<number | null>(null)
  const [nameQuery, setNameQuery] = useState('')
  const pending = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [step, setStep] = useState<OrderStep>('mesa')
  const [isOrdersOpen, setIsOrdersOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const stepsRef = useRef<HTMLDivElement>(null)
  const occupancy = useMemo(() => tableOccupancy(orders, now), [orders, now])

  // Minutes on the table map: refresh every 30 s.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  // A new step starts at the top with focus on its heading (not on first load).
  const previousStep = useRef(step)
  useEffect(() => {
    if (previousStep.current === step) return
    previousStep.current = step
    document.documentElement.scrollTop = 0
    stepsRef.current?.querySelector<HTMLElement>('[data-step-heading]')?.focus()
  }, [step])

  const reloadOrders = useCallback(async () => {
    try {
      setOrders(await source.listOpenOrders())
      setActionError(null)
    } catch (error) {
      setActionError(toUserMessage(error))
    }
  }, [source])

  // Another waiter or the cashier changed an order: refresh the list quietly, keeping any action message.
  const refreshOrders = useCallback(async () => {
    try {
      setOrders(await source.listOpenOrders())
    } catch {
      // Keep the current list; the next signal or action reloads it.
    }
  }, [source])
  useChangeSignal(source.subscribe, () => void refreshOrders())

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

  const canSubmit =
    draft.length > 0 && (addingToOrder !== null || (service !== null && canRegisterOrder(tableNumber, customerName)))

  async function handleSubmit(event: { preventDefault: () => void }) {
    event.preventDefault()
    if (!canSubmit || pending.current) return
    const now = new Date()
    const scheduledFor = addingToOrder ? null : pickupTimeToIso(pickupTime, now)
    if (!addingToOrder && pickupTime.trim() !== '' && !isFuturePickupTime(pickupTime, now)) {
      setMessage(null)
      setActionError(PICKUP_TIME_ERROR)
      return
    }
    const items = draftToPayload(draft)
    const succeeded = await runGuarded(async () => {
      if (addingToOrder) {
        await source.addOrderItems(addingToOrder.id, items)
      } else {
        const name = normalizeCustomerName(customerName) || null
        const notes = normalizeNotes(orderNotes)
        if (service === null) throw new Error('Elige si es para aquí o para llevar.')
        await source.createOrder({ tableNumber, customerName: name, items, notes, scheduledFor, service })
      }
    })
    if (!succeeded) return
    setMessage(addingToOrder ? 'Productos agregados al pedido.' : 'Pedido registrado correctamente.')
    setDraft([])
    setAddingToOrder(null)
    setStep('mesa')
    if (!addingToOrder) {
      setCustomerName('')
      setOrderNotes('')
      setPickupTime('')
      setTableNumber(null)
      setService(null)
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
    setIsOrdersOpen(false)
    setStep('productos')
  }

  function handleExitAdding() {
    if (pending.current) return
    setAddingToOrder(null)
    setDraft([])
    setStep('mesa')
  }

  function handleService(next: OrderService | null) {
    setService(next)
    // Takeaway orders carry no table: they are identified by the customer name.
    if (next === 'takeaway') setTableNumber(null)
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

  const legacyHidden = hideLegacyPizza(categories, products)
  const hasPizzaBuilder = pizzaCatalog !== null && pizzaCatalog.sizes.length > 0
  const visibleOrders = sortOrdersByName(filterOrders(orders, { tableNumber: filterTable, nameQuery }))
  const isFiltering = filterTable !== null || nameQuery.trim() !== ''

  const openOrdersSection = (
    <section className="flex min-w-0 flex-col gap-4" aria-label="Pedidos abiertos">
      <div className="flex flex-col gap-3">
        <label className="flex w-full min-w-0 flex-col gap-1 text-sm font-medium text-slate-700">
          Buscar por nombre
          <input
            type="search"
            value={nameQuery}
            placeholder="Nombre del cliente"
            onChange={(event) => setNameQuery(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base font-normal text-slate-900"
          />
        </label>
        <div className="flex items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={filterId} className="text-sm font-medium text-slate-700">
            Filtrar por mesa
          </label>
          <select
            id={filterId}
            value={filterTable ?? ''}
            onChange={(event) => setFilterTable(event.target.value === '' ? null : Number(event.target.value))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900"
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
        emptyMessage={isFiltering && orders.length > 0 ? 'No hay pedidos que coincidan.' : undefined}
        canCharge={canCharge}
        disabled={isSubmitting}
        onAddItems={handleStartAdding}
        onCancel={setOrderToCancel}
        onEditNotes={handleEditNotes}
      />
    </section>
  )

  const contextLabel = [
    tableNumber !== null ? tableLabel(tableNumber) : null,
    service !== null ? serviceLabel(service) : null,
    normalizeCustomerName(customerName) || null,
  ]
    .filter(Boolean)
    .join(' · ')
  const missingForReview = missingForOrder({
    itemCount: draftItemCount(draft),
    adding: addingToOrder !== null,
    service,
    tableNumber,
    customerName,
  })
  const missingForTable = missingForOrder({ itemCount: 1, adding: false, service, tableNumber, customerName })[0]

  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-2xl min-w-0 flex-col',
        aboveBottomNav
          ? 'pb-[calc(10rem+68px+env(safe-area-inset-bottom))] sm:pb-[calc(10rem+env(safe-area-inset-bottom))]'
          : 'pb-[calc(10rem+env(safe-area-inset-bottom))]',
      )}
    >
      {shift && onChangeWaiter && (
        <div className="m-4 mb-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="break-words font-semibold text-slate-900">Mesero: {shift.fullName}</p>
          <Button variant="secondary" disabled={isSubmitting} onClick={onChangeWaiter}>
            Cambiar mesero
          </Button>
        </div>
      )}
      <div className="sticky top-0 z-20 bg-white">
        <StepIndicator
          current={step}
          onGo={setStep}
          mesaLocked={addingToOrder !== null}
          disabled={isSubmitting}
        />
        {step === 'productos' &&
          (addingToOrder ? (
            <AddingToOrderBar order={addingToOrder} disabled={isSubmitting} onCancel={handleExitAdding} />
          ) : (
            <OrderContextBar label={contextLabel} onChange={() => setStep('mesa')} disabled={isSubmitting} />
          ))}
      </div>
      <div ref={stepsRef} className="flex w-full min-w-0 flex-col gap-4 p-4">
        {message && (
          <div
            role="status"
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200"
          >
            {message}
          </div>
        )}
        {step === 'mesa' && (
          <MesaStep
            service={service}
            onService={handleService}
            tableNumber={tableNumber}
            onTable={setTableNumber}
            customerName={customerName}
            onCustomerName={setCustomerName}
            occupancy={occupancy}
            openOrdersCount={orders.length}
            onOpenOrders={() => setIsOrdersOpen(true)}
            onAddToOrder={handleStartAdding}
            missing={missingForTable ? MISSING_LABEL[missingForTable] : null}
            onNext={() => setStep('productos')}
            aboveBottomNav={aboveBottomNav}
            disabled={isSubmitting}
          />
        )}
        {step === 'productos' && (
          <ProductsStep
            categories={legacyHidden.categories}
            products={legacyHidden.products}
            productQuantity={(productId) => productQuantity(draft, productId)}
            variantQuantity={(productId, variant) => productQuantity(draft, productId, variant)}
            onAddProduct={addProduct}
            onRemoveProduct={(product, variant) => updateDraft((c) => removeProductFromDraft(c, product.id, variant))}
            canBuildPizza={hasPizzaBuilder}
            pizzaCount={pizzaQuantity(draft)}
            onBuildPizza={() => setIsBuilderOpen(true)}
            itemCount={draftItemCount(draft)}
            onReview={() => setStep('revisar')}
            aboveBottomNav={aboveBottomNav}
            disabled={isSubmitting}
          />
        )}
        {step === 'revisar' && (
          <ReviewStep
            contextLabel={contextLabel}
            addingTo={addingToOrder}
            onChangeContext={() => setStep('mesa')}
            onCancelEdit={handleExitAdding}
            draft={draft}
            onIncrement={(id) => updateDraft((c) => incrementDraftLine(c, id))}
            onDecrement={(id) => updateDraft((c) => decrementDraftLine(c, id))}
            onRemove={(id) => updateDraft((c) => removeDraftLine(c, id))}
            onRestore={(line, index) => updateDraft((c) => restoreDraftLine(c, line, index))}
            onLineNotes={(id, notes) => updateDraft((c) => setDraftLineNotes(c, id, notes))}
            orderNotes={orderNotes}
            onOrderNotes={setOrderNotes}
            pickupTime={pickupTime}
            onPickupTime={setPickupTime}
            missing={missingForReview}
            error={actionError}
            isSubmitting={isSubmitting}
            onSubmit={handleSubmit}
            aboveBottomNav={aboveBottomNav}
          />
        )}
      </div>

      {isOrdersOpen && (
        <Sheet
          title="Pedidos abiertos"
          onClose={() => {
            // The note and cancel dialogs sit on top of this sheet: Escape belongs to them.
            if (notesOrder || orderToCancel) return
            setIsOrdersOpen(false)
          }}
        >
          {openOrdersSection}
        </Sheet>
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
