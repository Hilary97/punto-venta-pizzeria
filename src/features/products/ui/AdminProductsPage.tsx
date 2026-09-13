import { useEffect, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ErrorBanner } from '../../../shared/ui/ErrorBanner'
import { Spinner } from '../../../shared/ui/Spinner'
import { toUserMessage } from '../../../shared/errors'
import type { Category, CategoryFormValues, Product, ProductFormValues } from '../domain/product'
import {
  createCategory,
  createProduct,
  listCategories,
  listProducts,
  setProductActive,
  updateProduct,
} from '../infrastructure/productsRepository'
import { CategoryFormModal } from './CategoryFormModal'
import { ProductFormModal } from './ProductFormModal'
import { ProductsTable } from './ProductsTable'

type ModalState =
  | { kind: 'none' }
  | { kind: 'new-category' }
  | { kind: 'new-product' }
  | { kind: 'edit-product'; product: Product }

export function AdminProductsPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>({ kind: 'none' })

  async function reload() {
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const [loadedCategories, loadedProducts] = await Promise.all([listCategories(), listProducts()])
      setCategories(loadedCategories)
      setProducts(loadedProducts)
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  async function handleCreateCategory(values: CategoryFormValues) {
    await createCategory(values)
    await reload()
  }

  async function handleSubmitProduct(values: ProductFormValues) {
    if (modal.kind === 'edit-product') {
      await updateProduct(modal.product.id, values)
    } else {
      await createProduct(values)
    }
    await reload()
  }

  async function handleToggleActive(product: Product) {
    try {
      await setProductActive(product.id, !product.active)
      await reload()
    } catch (error) {
      setErrorMessage(toUserMessage(error))
    }
  }

  if (isLoading) {
    return <Spinner label="Cargando productos…" />
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Administración de productos</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setModal({ kind: 'new-category' })}>
            Nueva categoría
          </Button>
          <Button
            onClick={() => setModal({ kind: 'new-product' })}
            disabled={categories.length === 0}
          >
            Nuevo producto
          </Button>
        </div>
      </div>

      {errorMessage && <ErrorBanner message={errorMessage} />}

      {categories.length === 0 && (
        <p className="text-slate-500">Crea al menos una categoría antes de agregar productos.</p>
      )}

      <ProductsTable
        products={products}
        categories={categories}
        onEdit={(product) => setModal({ kind: 'edit-product', product })}
        onToggleActive={handleToggleActive}
      />

      {modal.kind === 'new-category' && (
        <CategoryFormModal onSubmit={handleCreateCategory} onClose={() => setModal({ kind: 'none' })} />
      )}

      {modal.kind === 'new-product' && (
        <ProductFormModal
          categories={categories}
          onSubmit={handleSubmitProduct}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}

      {modal.kind === 'edit-product' && (
        <ProductFormModal
          categories={categories}
          initial={modal.product}
          onSubmit={handleSubmitProduct}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}
    </div>
  )
}
