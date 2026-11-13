import { useEffect, useRef, useState } from 'react'
import { toUserMessage } from '../../../shared/errors'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import { describePizza, validatePizzaConfig, type PizzaCatalog } from '../domain/pizza'
import { listPizzaCatalog } from '../infrastructure/pizzaRepository'
import {
  addQuickPizza,
  deleteQuickPizza,
  listQuickPizzas,
  moveQuickPizza,
  type QuickPizza,
} from '../infrastructure/quickPizzaRepository'
import { PizzaBuilderModal, type BuiltPizza } from './PizzaBuilderModal'

const MAX_QUICK_PIZZAS = 8

/** Admin > Pizzas: the fixed pizzas the waiter sees first in "Más vendidas". */
export function QuickPizzasSection() {
  const [pizzas, setPizzas] = useState<QuickPizza[] | null>(null)
  const [catalog, setCatalog] = useState<PizzaCatalog | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isBuilderOpen, setIsBuilderOpen] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const added = useRef(false)

  async function reload() {
    try {
      setPizzas(await listQuickPizzas())
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    }
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([listQuickPizzas(), listPizzaCatalog()]).then(
      ([loaded, loadedCatalog]) => {
        if (cancelled) return
        setPizzas(loaded)
        // Admins can fix any size, even one without dough today.
        setCatalog({ ...loadedCatalog, sizes: loadedCatalog.sizes.map((size) => ({ ...size, doughLeft: null })) })
      },
      (error: unknown) => {
        if (!cancelled) setErrorMessage(toUserMessage(error))
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  async function run(action: () => Promise<void>) {
    setIsBusy(true)
    setErrorMessage(null)
    try {
      await action()
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    } finally {
      await reload()
      setIsBusy(false)
    }
  }

  function handleAdd(pizza: BuiltPizza) {
    if (added.current) return
    added.current = true
    setIsBuilderOpen(false)
    void run(() => addQuickPizza(pizza.config))
  }

  function nameOf(pizza: QuickPizza): string {
    if (!pizza.available || !catalog || validatePizzaConfig(pizza.pizza, catalog).length > 0) return 'No disponible'
    return describePizza(pizza.pizza, catalog)
  }

  const isFull = pizzas !== null && pizzas.length >= MAX_QUICK_PIZZAS

  return (
    <section aria-labelledby="quick-pizzas-admin-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="quick-pizzas-admin-heading" className="text-xl font-bold text-slate-900">
            Pizzas rápidas
          </h2>
          <p className="text-sm text-slate-500">
            El mesero las ve primero en "Más vendidas"; los lugares que sobren se completan con las más vendidas del mes.
          </p>
        </div>
        {catalog && pizzas && !isFull && (
          <Button
            disabled={isBusy}
            onClick={() => {
              added.current = false
              setIsBuilderOpen(true)
            }}
          >
            Agregar pizza rápida
          </Button>
        )}
      </div>

      {errorMessage && <ErrorBanner message={errorMessage} />}
      {isFull && <p className="text-sm text-slate-500">Llegaste al máximo de 8 pizzas rápidas.</p>}

      {pizzas === null && !errorMessage ? (
        <Spinner />
      ) : pizzas !== null && pizzas.length === 0 ? (
        <p className="text-sm text-slate-500">Todavía no fijaste ninguna: el mesero ve solo las más vendidas.</p>
      ) : (
        pizzas !== null && (
          <ol aria-label="Pizzas rápidas" className="flex list-none flex-col gap-2 p-0">
            {pizzas.map((pizza, index) => {
              const name = nameOf(pizza)
              return (
                <li
                  key={pizza.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
                >
                  <span className="w-6 text-sm font-bold text-slate-500">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p data-testid="quick-pizza-name" className="font-medium text-slate-900">
                      {name}
                    </p>
                    {name === 'No disponible' && (
                      <p className="text-xs text-amber-700 dark:text-amber-300">Ya no se ofrece: cambió el catálogo.</p>
                    )}
                  </div>
                  <Button variant="ghost" disabled={isBusy || index === 0} onClick={() => void run(() => moveQuickPizza(pizza.id, -1))}>
                    Subir
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={isBusy || index === pizzas.length - 1}
                    onClick={() => void run(() => moveQuickPizza(pizza.id, 1))}
                  >
                    Bajar
                  </Button>
                  <Button variant="ghost" disabled={isBusy} onClick={() => void run(() => deleteQuickPizza(pizza.id))}>
                    Quitar
                  </Button>
                </li>
              )
            })}
          </ol>
        )
      )}

      {isBuilderOpen && catalog && (
        <PizzaBuilderModal catalog={catalog} quickPick onAdd={handleAdd} onClose={() => setIsBuilderOpen(false)} />
      )}
    </section>
  )
}
