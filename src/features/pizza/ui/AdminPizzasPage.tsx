import { useEffect, useState, type ReactNode } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { MoneyText } from '../../../shared/ui/MoneyText'
import { Spinner } from '../../../shared/ui/Spinner'
import { portionLabel } from '../domain/pizza'
import type {
  AdminPizzaCatalog,
  AdminPizzaExtra,
  AdminPizzaIngredient,
  AdminPizzaSize,
  AdminPizzaStyle,
  ExtraFormValues,
  ExtraIngredientPriceFormValues,
  SplitFeesFormValues,
  IngredientFormValues,
  SizeFormValues,
  StyleFormValues,
} from '../domain/pizzaAdmin'
import { isFeeFree } from '../domain/pizzaAdmin'
import {
  createExtra,
  createIngredient,
  listAdminPizzaCatalog,
  saveStyle,
  setExtraActive,
  setIngredientActive,
  setStyleActive,
  updateExtra,
  updateExtraIngredientPrice,
  updateSplitFees,
  updateIngredient,
  updateSize,
} from '../infrastructure/pizzaAdminRepository'
import { PizzaExtraFormModal } from './PizzaExtraFormModal'
import { PizzaExtraIngredientPriceModal } from './PizzaExtraIngredientPriceModal'
import { PizzaSplitFeesModal } from './PizzaSplitFeesModal'
import { PizzaIngredientFormModal } from './PizzaIngredientFormModal'
import { PizzaSizeFormModal } from './PizzaSizeFormModal'
import { PizzaStyleFormModal } from './PizzaStyleFormModal'
import { nextSortOrder } from './pizzaAdminForm'

type ModalState =
  | { kind: 'none' }
  | { kind: 'size'; size: AdminPizzaSize }
  | { kind: 'style'; style?: AdminPizzaStyle }
  | { kind: 'ingredient'; ingredient?: AdminPizzaIngredient }
  | { kind: 'extra'; extra?: AdminPizzaExtra }
  | { kind: 'extraIngredientPrice' }
  | { kind: 'splitFees' }

const HEAD_CELL = 'px-4 py-3 font-semibold'
const CELL = 'px-4 py-3'

/** Admin editor for everything the pizza builder reads: sizes, styles with prices, ingredients and extras. */
export function AdminPizzasPage() {
  const [catalog, setCatalog] = useState<AdminPizzaCatalog | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>({ kind: 'none' })

  async function reload() {
    try {
      setCatalog(await listAdminPizzaCatalog())
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    listAdminPizzaCatalog().then(
      (loaded) => {
        if (cancelled) return
        setCatalog(loaded)
        setIsLoading(false)
      },
      (error: unknown) => {
        if (cancelled) return
        setErrorMessage(toUserMessage(error))
        setIsLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  const close = () => setModal({ kind: 'none' })

  /** Runs a row action (activate/deactivate) and reports its failure on the page. */
  async function runAction(action: () => Promise<void>) {
    try {
      await action()
      await reload()
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    }
  }

  async function handleSize(values: SizeFormValues) {
    if (modal.kind !== 'size') return
    await updateSize(modal.size.code, values)
    await reload()
  }

  async function handleStyle(values: StyleFormValues) {
    if (modal.kind !== 'style') return
    await saveStyle(modal.style?.id ?? null, values)
    await reload()
  }

  async function handleIngredient(values: IngredientFormValues) {
    if (modal.kind !== 'ingredient') return
    if (modal.ingredient) {
      await updateIngredient(modal.ingredient.id, values)
    } else {
      await createIngredient(values)
    }
    await reload()
  }

  async function handleExtra(values: ExtraFormValues) {
    if (modal.kind !== 'extra') return
    if (modal.extra) {
      await updateExtra(modal.extra.id, values)
    } else {
      await createExtra(values)
    }
    await reload()
  }

  async function handleExtraIngredientPrice(values: ExtraIngredientPriceFormValues) {
    await updateExtraIngredientPrice(values)
    await reload()
  }

  async function handleSplitFees(values: SplitFeesFormValues) {
    await updateSplitFees(values)
    await reload()
  }

  if (isLoading) return <Spinner label="Cargando pizzas…" />

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-slate-900">Pizzas</h1>
        <p className="text-sm text-slate-500">
          Lo que el mesero ve en "Armar pizza". Los precios se aplican al cobrar, también en pedidos abiertos.
        </p>
      </div>

      {errorMessage && <ErrorBanner message={errorMessage} />}

      {catalog && (
        <>
          <AdminSection id="pizza-sizes" title="Tamaños">
            <Table headers={['Tamaño', 'Se puede pedir', 'Acciones']}>
              {catalog.sizes.map((size) => (
                <tr key={size.code}>
                  <td className={`${CELL} font-medium text-slate-900`}>{size.name}</td>
                  <td className={CELL}>{size.allowedPortions.map(portionLabel).join(', ')}</td>
                  <td className={CELL}>
                    <Button variant="ghost" onClick={() => setModal({ kind: 'size', size })}>
                      Editar
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          </AdminSection>

          <AdminSection
            id="pizza-styles"
            title="Estilos"
            action={<Button onClick={() => setModal({ kind: 'style' })}>Nuevo estilo</Button>}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <dl>
                <dt className="text-slate-500">Cargo por elaboración</dt>
                <dd className="flex flex-wrap gap-x-4 text-lg font-semibold text-slate-900">
                  <span>
                    Mitades <MoneyText cents={catalog.splitFees.halves} />
                  </span>
                  <span>
                    Tercios <MoneyText cents={catalog.splitFees.thirds} />
                  </span>
                  <span>
                    Cuartos <MoneyText cents={catalog.splitFees.quarters} />
                  </span>
                </dd>
              </dl>
              <Button variant="secondary" onClick={() => setModal({ kind: 'splitFees' })}>
                Editar cargo
              </Button>
            </div>
            <Table headers={['Orden', 'Estilo', 'Tipo', ...catalog.sizes.map((size) => size.name), 'Estado', 'Acciones']}>
              {catalog.styles.map((style) => (
                <tr key={style.id}>
                  <td className={`${CELL} text-slate-500`}>{style.sortOrder}</td>
                  <td className={CELL}>
                    <p className="font-medium text-slate-900">{style.name}</p>
                    {style.description && <p className="text-xs text-slate-500">{style.description}</p>}
                  </td>
                  <td className={CELL}>
                    <p>
                      {style.kind === 'custom'
                        ? `Elige ${style.includedIngredients}`
                        : style.includedIngredients > 0
                          ? `${style.fixedIngredients} fijos + elige ${style.includedIngredients}`
                          : `${style.fixedIngredients} fijos`}
                    </p>
                    {isFeeFree(style) && <p className="text-xs text-emerald-700">Sin cargo por elaboración</p>}
                  </td>
                  {catalog.sizes.map((size) => (
                    <td key={size.code} className={CELL}>
                      {style.prices[size.code] === undefined ? '—' : <MoneyText cents={style.prices[size.code]!} />}
                    </td>
                  ))}
                  <td className={CELL}>
                    <ActiveBadge active={style.active} />
                  </td>
                  <td className={CELL}>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => setModal({ kind: 'style', style })}>
                        Editar
                      </Button>
                      <Button variant="ghost" onClick={() => runAction(() => setStyleActive(style.id, !style.active))}>
                        {style.active ? 'Desactivar' : 'Activar'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          </AdminSection>

          <AdminSection
            id="pizza-ingredients"
            title="Ingredientes"
            action={<Button onClick={() => setModal({ kind: 'ingredient' })}>Nuevo ingrediente</Button>}
          >
            <Table headers={['Orden', 'Ingrediente', 'Estado', 'Acciones']}>
              {catalog.ingredients.map((ingredient) => (
                <tr key={ingredient.id}>
                  <td className={`${CELL} text-slate-500`}>{ingredient.sortOrder}</td>
                  <td className={`${CELL} font-medium text-slate-900`}>{ingredient.name}</td>
                  <td className={CELL}>
                    <ActiveBadge active={ingredient.active} />
                  </td>
                  <td className={CELL}>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => setModal({ kind: 'ingredient', ingredient })}>
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => runAction(() => setIngredientActive(ingredient.id, !ingredient.active))}
                      >
                        {ingredient.active ? 'Desactivar' : 'Activar'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          </AdminSection>

          <AdminSection
            id="pizza-extras"
            title="Extras"
            action={<Button onClick={() => setModal({ kind: 'extra' })}>Nuevo extra</Button>}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <dl>
                <dt className="text-slate-500">Ingrediente extra (por porción)</dt>
                <dd className="text-lg font-semibold text-slate-900">
                  <MoneyText cents={catalog.extraIngredientCents} />
                </dd>
              </dl>
              <Button variant="secondary" onClick={() => setModal({ kind: 'extraIngredientPrice' })}>
                Editar precio
              </Button>
            </div>
            <Table headers={['Orden', 'Extra', 'Precio (por porción)', 'Estado', 'Acciones']}>
              {catalog.extras.map((extra) => (
                <tr key={extra.id}>
                  <td className={`${CELL} text-slate-500`}>{extra.sortOrder}</td>
                  <td className={`${CELL} font-medium text-slate-900`}>{extra.name}</td>
                  <td className={CELL}>
                    <MoneyText cents={extra.priceCents} />
                  </td>
                  <td className={CELL}>
                    <ActiveBadge active={extra.active} />
                  </td>
                  <td className={CELL}>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => setModal({ kind: 'extra', extra })}>
                        Editar
                      </Button>
                      <Button variant="ghost" onClick={() => runAction(() => setExtraActive(extra.id, !extra.active))}>
                        {extra.active ? 'Desactivar' : 'Activar'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          </AdminSection>

          {modal.kind === 'size' && <PizzaSizeFormModal size={modal.size} onSubmit={handleSize} onClose={close} />}
          {modal.kind === 'style' && (
            <PizzaStyleFormModal
              sizes={catalog.sizes}
              initial={modal.style}
              defaultSortOrder={nextSortOrder(catalog.styles)}
              onSubmit={handleStyle}
              onClose={close}
            />
          )}
          {modal.kind === 'ingredient' && (
            <PizzaIngredientFormModal
              initial={modal.ingredient}
              defaultSortOrder={nextSortOrder(catalog.ingredients)}
              onSubmit={handleIngredient}
              onClose={close}
            />
          )}
          {modal.kind === 'extra' && (
            <PizzaExtraFormModal
              initial={modal.extra}
              defaultSortOrder={nextSortOrder(catalog.extras)}
              onSubmit={handleExtra}
              onClose={close}
            />
          )}
          {modal.kind === 'splitFees' && (
            <PizzaSplitFeesModal initial={catalog.splitFees} onSubmit={handleSplitFees} onClose={close} />
          )}
          {modal.kind === 'extraIngredientPrice' && (
            <PizzaExtraIngredientPriceModal
              initialCents={catalog.extraIngredientCents}
              onSubmit={handleExtraIngredientPrice}
              onClose={close}
            />
          )}
        </>
      )}
    </div>
  )
}

function AdminSection({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-heading`} className="text-xl font-bold text-slate-900">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            {headers.map((header) => (
              <th key={header} className={HEAD_CELL}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">{children}</tbody>
      </table>
    </div>
  )
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={
        active
          ? 'rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800'
          : 'rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-600'
      }
    >
      {active ? 'Activo' : 'Inactivo'}
    </span>
  )
}
