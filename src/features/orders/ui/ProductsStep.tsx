import { Button } from '../../../shared/ui/Button'
import { cn } from '../../../shared/ui/cn'
import type { Category, Product } from '../../products/domain/product'
import { ProductGrid, QuantityBadge } from '../../sales/ui/ProductGrid'
import { StepBar } from './StepBar'

interface ProductsStepProps {
  categories: Category[]
  products: Product[]
  productQuantity: (productId: string) => number
  variantQuantity: (productId: string, variant: string) => number
  onAddProduct: (product: Product, variant: string | null) => void
  onRemoveProduct?: (product: Product, variant: string | null) => void
  /** Whether the pizza builder can be offered (the pizza catalog has sizes). */
  canBuildPizza: boolean
  pizzaCount: number
  onBuildPizza: () => void
  /** Total units in the order being composed. */
  itemCount: number
  onReview: () => void
  aboveBottomNav: boolean
  disabled?: boolean
}

export function ProductsStep({
  categories,
  products,
  productQuantity,
  variantQuantity,
  onAddProduct,
  onRemoveProduct,
  canBuildPizza,
  pizzaCount,
  onBuildPizza,
  itemCount,
  onReview,
  aboveBottomNav,
  disabled = false,
}: ProductsStepProps) {
  return (
    <section aria-labelledby="productos-heading" className="flex min-w-0 flex-col gap-4">
      <h2 id="productos-heading" tabIndex={-1} data-step-heading className="text-lg font-bold text-slate-900 focus:outline-none">
        Productos
      </h2>
      {canBuildPizza && (
        <div className="relative">
          <button
            type="button"
            disabled={disabled}
            onClick={onBuildPizza}
            className="flex min-h-[68px] w-full items-center gap-3 rounded-xl bg-red-700 px-3.5 text-left text-white shadow-sm hover:bg-red-800 disabled:opacity-50"
          >
            <svg viewBox="0 0 32 32" aria-hidden="true" className="size-9 shrink-0">
              <circle cx="16" cy="16" r="14" fill="#fff" />
              <path d="M16 16V2M16 16l12 7M16 16L4 23" stroke="#b91c1c" strokeWidth="2" />
              <circle cx="10" cy="10" r="2.5" fill="#b91c1c" />
              <circle cx="22" cy="11" r="2.5" fill="#b91c1c" />
              <circle cx="16" cy="24" r="2.5" fill="#b91c1c" />
            </svg>
            <span className="min-w-0">
              <strong className="block text-[17px]">Armar pizza</strong>
              <span className="text-[13px]">Tamaño, mitades y extras</span>
            </span>
            {pizzaCount > 0 && <QuantityBadge quantity={pizzaCount} />}
          </button>
        </div>
      )}
      <ProductGrid
        categories={categories}
        products={products}
        productQuantity={productQuantity}
        variantQuantity={variantQuantity}
        onAddProduct={onAddProduct}
        onRemoveProduct={onRemoveProduct}
        disabled={disabled}
        showPrices={false}
      />
      <StepBar aboveBottomNav={aboveBottomNav}>
        <Button
          size="lg"
          disabled={itemCount === 0 || disabled}
          onClick={onReview}
          className={cn('min-h-14 w-full justify-between px-4 text-base disabled:bg-slate-300 disabled:text-slate-700 disabled:opacity-100')}
        >
          <span>{itemCount === 0 ? 'Agrega productos' : `${itemCount} ${itemCount === 1 ? 'producto' : 'productos'}`}</span>{' '}
          <span>Revisar pedido →</span>
        </Button>
      </StepBar>
    </section>
  )
}
