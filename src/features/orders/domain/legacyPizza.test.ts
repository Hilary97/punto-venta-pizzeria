import { describe, expect, it } from 'vitest'
import type { Category, Product } from '../../products/domain/product'
import { hideLegacyPizza } from './legacyPizza'

const categories: Category[] = [
  { id: 'c1', name: 'Pizzas viejas', sortOrder: 0, legacyPizza: true },
  { id: 'c2', name: 'Botanas', sortOrder: 1 },
]
const products: Product[] = [
  { id: 'p1', categoryId: 'c1', name: 'Pizza queso', priceCents: 0, active: true, variants: [] },
  { id: 'p2', categoryId: 'c2', name: 'Alitas', priceCents: 0, active: true, variants: [] },
]

describe('hideLegacyPizza', () => {
  it('drops the flagged legacy pizza category and its products, whatever its name', () => {
    const result = hideLegacyPizza(categories, products)
    expect(result.categories.map((c) => c.id)).toEqual(['c2'])
    expect(result.products.map((p) => p.id)).toEqual(['p2'])
  })

  it('keeps a category named Pizzas that is not flagged', () => {
    const pizzas: Category = { id: 'c1', name: 'Pizzas', sortOrder: 0, legacyPizza: false }
    const result = hideLegacyPizza([pizzas], products)
    expect(result).toEqual({ categories: [pizzas], products })
  })

  it('keeps everything when no category is flagged', () => {
    const result = hideLegacyPizza([categories[1]!], [products[1]!])
    expect(result).toEqual({ categories: [categories[1]], products: [products[1]] })
  })
})
