import { describe, expect, it } from 'vitest'
import type { PizzaConfig } from '../../pizza/domain/pizza'
import { mapOrderRow, orderRowSchema, toRpcItems } from './ordersRepository'

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

  it('sends the variant when present', () => {
    expect(toRpcItems([{ type: 'product', productId: 'p', quantity: 1, variant: 'Res' }])).toEqual([
      { type: 'product', product_id: 'p', quantity: 1, notes: null, variant: 'Res' },
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

describe('mapOrderRow', () => {
  const base = {
    id: 'o',
    table_number: 1,
    customer_name: null,
    status: 'open' as const,
    created_at: '2026-10-10T10:00:00Z',
    waiter_name: null,
    notes: null,
  }
  const line = {
    id: 'l',
    product_id: null,
    product_name: 'X',
    quantity: 1,
    item_type: 'product' as const,
    pizza: null,
    notes: null,
  }

  it('maps station, readyAt and deliveredAt when present', () => {
    const row = orderRowSchema.parse({
      ...base,
      order_items: [{ ...line, station: 'grill', ready_at: '2026-10-10T10:05:00Z', delivered_at: null }],
    })
    expect(mapOrderRow(row).items[0]).toMatchObject({
      station: 'grill',
      readyAt: '2026-10-10T10:05:00Z',
      deliveredAt: null,
    })
  })

  it('defaults them to null when the rpc omits them', () => {
    const row = orderRowSchema.parse({ ...base, order_items: [line] })
    expect(mapOrderRow(row).items[0]).toMatchObject({ station: null, readyAt: null, deliveredAt: null })
  })
})
