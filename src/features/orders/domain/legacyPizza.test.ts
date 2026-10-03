import { describe, expect, it } from 'vitest'
import type { Category, Product } from '../../products/domain/product'
import { hideLegacyPizza } from './legacyPizza'

const categories: Category[] = [
  { id: 'c1', name: 'Pizzas', sortOrder: 0 },
  { id: 'c2', name: 'Botanas', sortOrder: 1 },
]
const products: Product[] = [
  { id: 'p1', categoryId: 'c1', name: 'Pizza queso', priceCents: 0, active: true, variants: [] },
  { id: 'p2', categoryId: 'c2', name: 'Alitas', priceCents: 0, active: true, variants: [] },
]

describe('hideLegacyPizza', () => {
  it('drops the Pizzas category and its products', () => {
    const result = hideLegacyPizza(categories, products)
    expect(result.categories.map((c) => c.id)).toEqual(['c2'])
    expect(result.products.map((p) => p.id)).toEqual(['p2'])
  })

  it('matches the category name ignoring case and surrounding spaces', () => {
    const result = hideLegacyPizza([{ id: 'c1', name: '  PIZZAS ', sortOrder: 0 }], products)
    expect(result.categories).toEqual([])
    expect(result.products.map((p) => p.id)).toEqual(['p2'])
  })

  it('keeps everything when there is no Pizzas category', () => {
    const result = hideLegacyPizza([categories[1]!], [products[1]!])
    expect(result).toEqual({ categories: [categories[1]], products: [products[1]] })
  })
})
