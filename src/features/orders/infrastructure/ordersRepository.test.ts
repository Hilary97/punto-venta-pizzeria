import { describe, expect, it } from 'vitest'
import type { PizzaConfig } from '../../pizza/domain/pizza'
import { toRpcItems } from './ordersRepository'

const pizza: PizzaConfig = {
  size: 'grande',
  portions: [
    { styleId: 's1', ingredientIds: ['i1'], extraIngredientIds: ['i2'], extraCheese: true },
    { styleId: 's2', ingredientIds: [], extraIngredientIds: [], extraCheese: false },
  ],
}

describe('toRpcItems', () => {
  it('maps product lines with null notes by default', () => {
    expect(toRpcItems([{ type: 'product', productId: 'p', quantity: 2 }])).toEqual([
      { type: 'product', product_id: 'p', quantity: 2, notes: null },
    ])
  })

  it('maps pizza lines to the snake_case config and keeps notes', () => {
    expect(toRpcItems([{ type: 'pizza', pizza, quantity: 1, notes: 'bien cocida' }])).toEqual([
      {
        type: 'pizza',
        pizza: {
          size: 'grande',
          portions: [
            { style_id: 's1', ingredient_ids: ['i1'], extra_ingredient_ids: ['i2'], extra_cheese: true },
            { style_id: 's2', ingredient_ids: [], extra_ingredient_ids: [], extra_cheese: false },
          ],
        },
        quantity: 1,
        notes: 'bien cocida',
      },
    ])
  })
})
