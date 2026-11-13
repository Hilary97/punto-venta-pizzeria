import { useEffect, useId, useRef, useState } from "react";
import { Input } from "../../../shared/ui/Input";
import { cn } from "../../../shared/ui/cn";
import { MoneyText } from "../../../shared/ui/MoneyText";
import { isSoldOut, type Category, type Product } from "../../products/domain/product";

interface ProductGridProps {
  categories: Category[];
  products: Product[];
  /** Units of the product in the order, across all its variants. */
  productQuantity: (productId: string) => number;
  /** Units of one variant of the product in the order. */
  variantQuantity: (productId: string, variant: string) => number;
  /** Adds one unit; `variant` is `null` for products without variants. */
  onAddProduct: (product: Product, variant: string | null) => void;
  /** Removes one unit; fired by holding a tile or variant chip that is in the order. */
  onRemoveProduct?: (product: Product, variant: string | null) => void;
  disabled?: boolean;
  showPrices?: boolean;
}

export function ProductGrid({
  categories,
  products,
  productQuantity,
  variantQuantity,
  onAddProduct,
  onRemoveProduct,
  disabled = false,
  showPrices = true,
}: ProductGridProps) {
  const press = useLongPress();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  // Starts on the first category; falls back to it if the chosen one disappears.
  const activeCategoryId =
    categories.find((category) => category.id === selectedCategoryId)?.id ?? categories[0]?.id ?? null;
  const searching = query.trim() !== "";

  const pillsRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState(false);
  function updateFade() {
    const el = pillsRef.current;
    if (el) setFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }
  useEffect(() => {
    updateFade();
    window.addEventListener("resize", updateFade);
    return () => window.removeEventListener("resize", updateFade);
  }, [categories]);

  const visibleProducts = products.filter(
    (product) =>
      (searching || activeCategoryId === null || product.categoryId === activeCategoryId) &&
      product.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Input
        id={searchId}
        type="search"
        label="Buscar producto por nombre"
        placeholder="Buscar producto…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="relative">
      <div
        ref={pillsRef}
        role="group"
        aria-label="Categorías"
        onScroll={updateFade}
        className="flex gap-2 overflow-x-auto pb-1"
      >
        {categories.map((category) => (
          <CategoryPill
            key={category.id}
            selected={activeCategoryId === category.id}
            onClick={() => setSelectedCategoryId(category.id)}
          >
            {category.name}
          </CategoryPill>
        ))}
      </div>
      {fade && (
        <div
          data-testid="categories-fade"
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-slate-50 to-transparent"
        />
      )}
      </div>

      {visibleProducts.length === 0 ? (
        <p className="p-4 text-center text-slate-500">
          {products.length === 0
            ? "No hay productos disponibles."
            : "No hay productos que coincidan con la búsqueda y categoría."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {visibleProducts.map((product) => {
            const soldOut = isSoldOut(product);
            const hasVariants = product.variants.length > 0;
            const total = productQuantity(product.id);
            return (
              <li
                key={product.id}
                className={cn(
                  "relative flex min-w-0 flex-col rounded-xl border-2 transition-colors",
                  hasVariants && "col-span-full",
                  total > 0
                    ? "border-red-700 bg-red-50 dark:bg-red-950/60"
                    : "border-slate-300 bg-white",
                  soldOut && "border-dashed bg-slate-100",
                )}
              >
                {hasVariants ? (
                  <div className="flex flex-col gap-1.5 p-2.5">
                    <span className="break-words text-sm font-bold text-slate-900">{product.name}</span>
                    {soldOut ? (
                      <SoldOutBadge />
                    ) : (
                      <div
                        role="group"
                        aria-label={`Elige: ${product.name}`}
                        className="flex flex-wrap items-center gap-1.5"
                      >
                        <span className="text-[13px] font-semibold text-slate-600">Elige:</span>
                        {product.variants.map((variant) => {
                          const count = variantQuantity(product.id, variant);
                          return (
                            <button
                              key={variant}
                              type="button"
                              disabled={disabled}
                              {...press(
                                () => onAddProduct(product, variant),
                                count > 0 && onRemoveProduct ? () => onRemoveProduct(product, variant) : undefined,
                              )}
                              className={cn(
                                "min-h-11 select-none rounded-full border-2 px-3.5 text-sm font-semibold [-webkit-touch-callout:none] disabled:opacity-50",
                                count > 0
                                  ? "border-red-700 bg-red-700 text-white"
                                  : "border-slate-300 bg-white text-slate-900",
                              )}
                            >
                              {variant}
                              {count > 0 && <> <span>×{count}</span></>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={disabled || soldOut}
                    {...press(
                      () => onAddProduct(product, null),
                      total > 0 && onRemoveProduct ? () => onRemoveProduct(product, null) : undefined,
                    )}
                    className="flex min-h-16 w-full min-w-0 select-none flex-col items-start justify-center gap-1 break-words rounded-xl [-webkit-touch-callout:none] px-2.5 py-2 text-left text-sm font-bold leading-tight text-slate-900 transition-transform active:scale-95 disabled:text-slate-600"
                  >
                    <span>{product.name}</span>
                    {soldOut && <SoldOutBadge />}
                    {showPrices && (
                      <MoneyText cents={product.priceCents} className="text-lg font-bold text-red-700" />
                    )}
                  </button>
                )}
                {total > 0 && <QuantityBadge quantity={total} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const LONG_PRESS_MS = 500;

/**
 * Tap runs `onTap`; holding for LONG_PRESS_MS runs `onLongPress` instead and swallows the
 * click that follows the release, so holding never adds. Without `onLongPress` a hold does nothing.
 */
function useLongPress() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (onTap: () => void, onLongPress?: () => void) => ({
    onPointerDown: () => {
      cancel();
      fired.current = false;
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        if (!onLongPress) return;
        onLongPress();
        navigator.vibrate?.(30);
      }, LONG_PRESS_MS);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
    onClick: () => {
      if (fired.current) {
        fired.current = false;
        return;
      }
      onTap();
    },
  });
}

function CategoryPill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "min-h-11 shrink-0 whitespace-nowrap rounded-full border-2 px-3.5 text-sm font-semibold transition-colors",
        selected ? "border-red-700 bg-red-700 text-white" : "border-slate-300 bg-white text-slate-800",
      )}
    >
      {children}
    </button>
  );
}

/** `×2` on the corner of a tile; the hidden prefix tells screen readers what the number is. */
export function QuantityBadge({ quantity, className }: { quantity: number; className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute -right-1 -top-2 grid h-[26px] min-w-[34px] place-items-center rounded-full border-2 border-white dark:border-slate-50 bg-red-700 px-1 text-sm font-extrabold text-white",
        className,
      )}
    >
      <span className="sr-only">En el pedido: </span>×{quantity}
    </span>
  );
}

function SoldOutBadge() {
  return (
    <span className="self-start rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold uppercase text-slate-700">
      Agotado
    </span>
  );
}
