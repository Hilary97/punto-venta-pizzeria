import { useEffect, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import { toUserMessage } from '../../../shared/errors'
import { supplyStatus, SUPPLY_UNIT_LABELS, type Supply, type SupplyFormValues } from '../domain/supply'
import {
  countSupply,
  createSupply,
  listSupplies,
  recordPurchase,
  updateSupply,
} from '../infrastructure/suppliesRepository'
import { formatQuantityWithUnit } from './formatQuantity'
import { PurchasesHistory } from './PurchasesHistory'
import { SupplyFormModal } from './SupplyFormModal'
import { SupplyMovementModal } from './SupplyMovementModal'

type ModalState =
  | { kind: 'none' }
  | { kind: 'new-supply' }
  | { kind: 'edit-supply'; supply: Supply }
  | { kind: 'purchase'; supply: Supply }
  | { kind: 'count'; supply: Supply }

export function AdminSuppliesPage() {
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>({ kind: 'none' })
  const [historyReloadKey, setHistoryReloadKey] = useState(0)

  async function loadSupplies() {
    try {
      const loaded = await listSupplies()
      setSupplies([...loaded].sort((a, b) => a.name.localeCompare(b.name)))
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadSupplies()
  }, [])

  async function handleSubmitSupply(values: SupplyFormValues) {
    if (modal.kind === 'edit-supply') {
      await updateSupply(modal.supply.id, values)
    } else {
      await createSupply(values)
    }
    await loadSupplies()
  }

  async function handlePurchase(supply: Supply, quantity: number, costCents: number) {
    await recordPurchase(supply.id, quantity, costCents)
    await loadSupplies()
    setHistoryReloadKey((key) => key + 1)
  }

  async function handleCount(supply: Supply, counted: number) {
    await countSupply(supply.id, counted)
    await loadSupplies()
  }

  if (isLoading) {
    return <Spinner label="Cargando insumos…" />
  }

  const toBuy = supplies.filter((supply) => supply.active && supplyStatus(supply) === 'buy')
  const closeModal = () => setModal({ kind: 'none' })

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Insumos</h1>
        <Button onClick={() => setModal({ kind: 'new-supply' })}>Nuevo insumo</Button>
      </div>

      {errorMessage && <ErrorBanner message={errorMessage} />}

      {toBuy.length > 0 && (
        <div
          role="region"
          aria-label="Insumos para comprar"
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
        >
          Para comprar: {toBuy.map((supply) => supply.name).join(', ')}
        </div>
      )}

      {supplies.length === 0 && !errorMessage ? (
        <p className="p-4 text-center text-slate-500">Aún no hay insumos. Agrega el primero con Nuevo insumo.</p>
      ) : (
        supplies.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table aria-label="Lista de insumos" className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Insumo</th>
                  <th className="px-4 py-3 font-semibold">Unidad</th>
                  <th className="px-4 py-3 font-semibold">Existencias</th>
                  <th className="px-4 py-3 font-semibold">Mínimo</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {supplies.map((supply) => {
                  const needsBuying = supplyStatus(supply) === 'buy'
                  return (
                    <tr key={supply.id}>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {supply.name}
                        {!supply.active && (
                          <span className="ml-2 rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">
                            Inactivo
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">{SUPPLY_UNIT_LABELS[supply.unit]}</td>
                      <td className="px-4 py-3">{formatQuantityWithUnit(supply.stock, supply.unit)}</td>
                      <td className="px-4 py-3">{formatQuantityWithUnit(supply.stockMin, supply.unit)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${
                            needsBuying ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {needsBuying ? 'Por comprar' : 'OK'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button variant="ghost" size="md" onClick={() => setModal({ kind: 'purchase', supply })}>
                            Compra
                          </Button>
                          <Button variant="ghost" size="md" onClick={() => setModal({ kind: 'count', supply })}>
                            Conteo
                          </Button>
                          <Button variant="ghost" size="md" onClick={() => setModal({ kind: 'edit-supply', supply })}>
                            Editar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      <PurchasesHistory reloadKey={historyReloadKey} />

      {(modal.kind === 'new-supply' || modal.kind === 'edit-supply') && (
        <SupplyFormModal
          initial={modal.kind === 'edit-supply' ? modal.supply : undefined}
          onSubmit={handleSubmitSupply}
          onClose={closeModal}
        />
      )}

      {(modal.kind === 'purchase' || modal.kind === 'count') && (
        <SupplyMovementModal
          mode={modal.kind}
          supply={modal.supply}
          onPurchase={(quantity, costCents) => handlePurchase(modal.supply, quantity, costCents)}
          onCount={(counted) => handleCount(modal.supply, counted)}
          onClose={closeModal}
        />
      )}
    </div>
  )
}
