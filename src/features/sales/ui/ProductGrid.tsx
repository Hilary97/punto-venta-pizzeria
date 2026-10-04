import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Input } from "../../../shared/ui/Input";
import { cn } from "../../../shared/ui/cn";
import { MoneyText } from "../../../shared/ui/MoneyText";
import type { Category, Product } from "../../products/domain/product";

interface ProductGridProps {
  categories: Category[];
  products: Product[];
  cartProductIds: Set<string>;
  onSelectProduct: (product: Product) => void;
  disabled?: boolean;
  showPrices?: boolean;
  /** Rendered instead of every product while "all" is selected and the search is empty. */
  allContent?: ReactNode;
  /** When set with allContent, "all" moves out of the category pills into a fixed bottom button. */
  allContentLabel?: string;
  /** Rendered at the top of the sticky search/category header. */
  stickyHeader?: ReactNode;
}

export function ProductGrid({
  categories,
  products,
  cartProductIds,
  onSelectProduct,
  disabled = false,
  showPrices = true,
  allContent,
  allContentLabel,
  stickyHeader,
}: ProductGridProps) {
  const hasBottomAllButton =
    allContent !== undefined && allContentLabel !== undefined;
  const allContentRef = useRef<HTMLDivElement>(null);
  // Bumped on every bottom-button press; the effect scrolls once the content is rendered.
  const [allScrollRequest, setAllScrollRequest] = useState(0);

  useEffect(() => {
    if (allScrollRequest === 0) return;
    allContentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [allScrollRequest]);
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | "all">(
    "all",
  );

  const visibleProducts = products.filter(
    (product) =>
      (selectedCategoryId === "all" ||
        product.categoryId === selectedCategoryId) &&
      product.name
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="sticky top-0 z-10 flex flex-col gap-4 bg-slate-50 pb-2">
        {stickyHeader}
        <Input
          id={searchId}
          type="search"
          label="Buscar producto por nombre"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div
          role="group"
          aria-label="Categorías"
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {!hasBottomAllButton && (
            <button
              type="button"
              onClick={() => setSelectedCategoryId("all")}
              className={cn(
                "shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                selectedCategoryId === "all"
                  ? "bg-red-700 text-white"
                  : "bg-slate-200 text-slate-700",
              )}
            >
              Todos
            </button>
          )}
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setSelectedCategoryId(category.id)}
              className={cn(
                "shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                selectedCategoryId === category.id
                  ? "bg-red-700 text-white"
                  : "bg-slate-200 text-slate-700",
              )}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      {hasBottomAllButton && (
        <button
          type="button"
          aria-pressed={selectedCategoryId === "all"}
          onClick={() => {
            setSelectedCategoryId("all");
            setQuery("");
            setAllScrollRequest((count) => count + 1);
          }}
          className={cn(
            "fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 rounded-2xl px-5 py-4 font-semibold text-white shadow-lg transition-colors lg:left-auto lg:w-80",
            selectedCategoryId === "all" && query.trim() === ""
              ? "bg-emerald-800"
              : "bg-emerald-600 hover:bg-emerald-700",
          )}
        >
          {allContentLabel}
        </button>
      )}

      {allContent !== undefined &&
      selectedCategoryId === "all" &&
      query.trim() === "" ? (
        <div ref={allContentRef} className="min-w-0 scroll-mt-40">
          {allContent}
        </div>
      ) : visibleProducts.length === 0 ? (
        <p className="p-4 text-center text-slate-500">
          {products.length === 0
            ? "No hay productos disponibles."
            : "No hay productos que coincidan con la búsqueda y categoría."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
          {visibleProducts.map((product) => {
            const isInCart = cartProductIds.has(product.id);
            return (
              <button
                key={product.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelectProduct(product)}
                className={cn(
                  "flex min-w-0 min-h-28 break-words disabled:opacity-50 flex-col justify-between rounded-2xl border-2 p-4 text-left shadow-sm transition-colors transition-transform hover:shadow-md active:scale-95",
                  isInCart
                    ? "border-emerald-600 bg-emerald-50 hover:border-emerald-600"
                    : "border-slate-200 bg-white hover:border-red-400",
                )}
              >
                <span className="font-semibold text-slate-900">
                  {product.name}
                </span>
                {showPrices && (
                  <MoneyText
                    cents={product.priceCents}
                    className="text-lg font-bold text-red-700"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
