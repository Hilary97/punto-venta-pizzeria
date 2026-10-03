import type { Category, Product } from '../../products/domain/product'

const LEGACY_PIZZA_CATEGORY = 'pizzas'

/**
 * Hides the legacy fixed pizza products (category `Pizzas`) from the waiter grid:
 * pizzas are now built with the pizza builder. The products stay in the database
 * so open orders that contain them keep displaying.
 */
export function hideLegacyPizza(
  categories: Category[],
  products: Product[],
): { categories: Category[]; products: Product[] } {
  const hiddenIds = new Set(
    categories.filter((category) => category.name.trim().toLowerCase() === LEGACY_PIZZA_CATEGORY).map((c) => c.id),
  )
  return {
    categories: categories.filter((category) => !hiddenIds.has(category.id)),
    products: products.filter((product) => !hiddenIds.has(product.categoryId)),
  }
}
