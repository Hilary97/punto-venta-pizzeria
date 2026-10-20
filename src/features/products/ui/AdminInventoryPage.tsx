import { useEffect, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import { toUserMessage } from '../../../shared/errors'
import { stockStatus, type Product, type StockStatus } from '../domain/product'
import { countStock, listProducts, receiveStock } from '../infrastructure/productsRepository'
import { StockAdjustModal, type StockAdjustMode } from './StockAdjustModal'

const STATUS_LABEL: Partial<Record<StockStatus, string>> = { ok: 'OK', low: 'Stock bajo', out: 'Agotado' }

const STATUS_CLASS: Partial<Record<StockStatus, string>> = {
  ok: 'bg-emerald-100 text-emerald-800',
  low: 'bg-amber-100 text-amber-800',
  out: 'bg-red-100 text-red-800',
}

interface AdjustState {
  mode: StockAdjustMode
  product: Product
}

export function AdminInventoryPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [adjust, setAdjust] = useState<AdjustState | null>(null)

  async function loadProducts() {
    try {
      const loaded = await listProducts()
      setProducts(loaded.filter((product) => product.trackStock).sort((a, b) => a.name.localeCompare(b.name)))
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadProducts()
  }, [])

  async function handleAdjust(value: number) {
    if (!adjust) return
    if (adjust.mode === 'receive') {
      await receiveStock(adjust.product.id, value)
    } else {
      await countStock(adjust.product.id, value)
    }
    await loadProducts()
  }

  if (isLoading) {
    return <Spinner label="Cargando inventario…" />
  }

  const toRestock = products.filter((product) => stockStatus(product) !== 'ok')

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-slate-900">Inventario</h1>

      {errorMessage && <ErrorBanner message={errorMessage} />}

      {toRestock.length > 0 && (
        <div
          role="region"
          aria-label="Productos por reponer"
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
        >
          Productos por reponer: {toRestock.map((product) => product.name).join(', ')}
        </div>
      )}

      {products.length === 0 && !errorMessage ? (
        <p className="p-4 text-center text-slate-500">Ningún producto controla inventario. Actívalo en Productos.</p>
      ) : (
        products.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Producto</th>
                  <th className="px-4 py-3 font-semibold">Existencias</th>
                  <th className="px-4 py-3 font-semibold">Mínimo</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {products.map((product) => {
                  const status = stockStatus(product)
                  return (
                    <tr key={product.id}>
                      <td className="px-4 py-3 font-medium text-slate-900">{product.name}</td>
                      <td className="px-4 py-3">{product.stock}</td>
                      <td className="px-4 py-3">{product.stockMin}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_CLASS[status] ?? ''}`}>
                          {STATUS_LABEL[status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button variant="ghost" size="md" onClick={() => setAdjust({ mode: 'receive', product })}>
                            Entrada
                          </Button>
                          <Button variant="ghost" size="md" onClick={() => setAdjust({ mode: 'count', product })}>
                            Conteo
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

      {adjust && (
        <StockAdjustModal
          mode={adjust.mode}
          productName={adjust.product.name}
          currentStock={adjust.product.stock ?? 0}
          onSubmit={handleAdjust}
          onClose={() => setAdjust(null)}
        />
      )}
    </div>
  )
}
