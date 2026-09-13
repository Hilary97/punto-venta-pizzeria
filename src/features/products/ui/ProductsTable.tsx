import { MoneyText } from '../../../shared/ui/MoneyText'
import { Button } from '../../../shared/ui/Button'
import type { Category, Product } from '../domain/product'

interface ProductsTableProps {
  products: Product[]
  categories: Category[]
  onEdit: (product: Product) => void
  onToggleActive: (product: Product) => void
}

export function ProductsTable({ products, categories, onEdit, onToggleActive }: ProductsTableProps) {
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '—'

  if (products.length === 0) {
    return <p className="p-4 text-center text-slate-500">Aún no hay productos registrados.</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            <th className="px-4 py-3 font-semibold">Producto</th>
            <th className="px-4 py-3 font-semibold">Categoría</th>
            <th className="px-4 py-3 font-semibold">Precio</th>
            <th className="px-4 py-3 font-semibold">Estado</th>
            <th className="px-4 py-3 font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {products.map((product) => (
            <tr key={product.id}>
              <td className="px-4 py-3 font-medium text-slate-900">{product.name}</td>
              <td className="px-4 py-3 text-slate-600">{categoryName(product.categoryId)}</td>
              <td className="px-4 py-3">
                <MoneyText cents={product.priceCents} />
              </td>
              <td className="px-4 py-3">
                <span
                  className={
                    product.active
                      ? 'rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800'
                      : 'rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-600'
                  }
                >
                  {product.active ? 'Activo' : 'Inactivo'}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-2">
                  <Button variant="ghost" size="md" onClick={() => onEdit(product)}>
                    Editar
                  </Button>
                  <Button variant="ghost" size="md" onClick={() => onToggleActive(product)}>
                    {product.active ? 'Desactivar' : 'Activar'}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
