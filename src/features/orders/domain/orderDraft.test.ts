import { describe, expect, it } from 'vitest'
import type { PizzaConfig } from '../../pizza/domain/pizza'
import {
  addPizzaToDraft,
  addToDraft,
  decrementDraftLine,
  draftItemCount,
  draftToPayload,
  incrementDraftLine,
  removeDraftLine,
  setDraftLineNotes,
} from './orderDraft'
import type { DraftLine } from './orderDraft'

const margarita: DraftLine = { lineId: 'l1', kind: 'product', productId: 'p1', name: 'Pizza Margarita', quantity: 1, notes: '' }
const soda: DraftLine = { lineId: 'l2', kind: 'product', productId: 'p2', name: 'Refresco', quantity: 1, notes: '' }
const config: PizzaConfig = {
  size: 'grande',
  portions: [{ styleId: 's1', ingredientIds: [], extraIngredientIds: [], extraCheese: false }],
}
const pizzaLine: DraftLine = { lineId: 'l3', kind: 'pizza', pizza: config, name: 'Pizza Grande: Varas', quantity: 1, notes: '' }

describe('addToDraft', () => {
  it('adds a new product with quantity 1 and empty notes', () => {
    expect(addToDraft([], { lineId: 'l1', productId: 'p1', name: 'Pizza Margarita' })).toEqual([margarita])
  })

  it('increments quantity when the product already exists without notes', () => {
    expect(addToDraft([margarita], { lineId: 'x', productId: 'p1', name: 'Pizza Margarita' })).toEqual([
      { ...margarita, quantity: 2 },
    ])
  })

  it('appends a separate line when the existing product line has notes', () => {
    const withNotes = { ...margarita, notes: 'sin cebolla' }
    expect(addToDraft([withNotes], { lineId: 'x', productId: 'p1', name: 'Pizza Margarita' })).toEqual([
      withNotes,
      { ...margarita, lineId: 'x' },
    ])
  })
})

describe('addPizzaToDraft', () => {
  it('always appends a new pizza line, even for identical configs', () => {
    const once = addPizzaToDraft([], { lineId: 'l3', pizza: config, name: pizzaLine.name, notes: '' })
    expect(once).toEqual([pizzaLine])
    const twice = addPizzaToDraft(once, { lineId: 'l4', pizza: config, name: pizzaLine.name, notes: 'bien cocida' })
    expect(twice).toHaveLength(2)
    expect(twice[1]).toMatchObject({ lineId: 'l4', kind: 'pizza', quantity: 1, notes: 'bien cocida' })
  })
})

describe('incrementDraftLine', () => {
  it('increases only the matching line', () => {
    expect(incrementDraftLine([margarita, soda], 'l2')).toEqual([margarita, { ...soda, quantity: 2 }])
  })

  it('works on pizza lines', () => {
    expect(incrementDraftLine([pizzaLine], 'l3')[0]?.quantity).toBe(2)
  })
})

describe('decrementDraftLine', () => {
  it('decreases quantity by one', () => {
    expect(decrementDraftLine([{ ...margarita, quantity: 3 }], 'l1')).toEqual([{ ...margarita, quantity: 2 }])
  })

  it('removes the line when quantity reaches zero', () => {
    expect(decrementDraftLine([margarita, soda], 'l1')).toEqual([soda])
  })
})

describe('removeDraftLine', () => {
  it('removes the line regardless of quantity', () => {
    expect(removeDraftLine([{ ...margarita, quantity: 5 }, soda], 'l1')).toEqual([soda])
  })
})

describe('setDraftLineNotes', () => {
  it('updates the notes of the matching line only', () => {
    expect(setDraftLineNotes([margarita, soda], 'l2', 'sin hielo')).toEqual([margarita, { ...soda, notes: 'sin hielo' }])
  })
})

describe('draftItemCount', () => {
  it('returns 0 for an empty draft', () => {
    expect(draftItemCount([])).toBe(0)
  })

  it('sums quantities across lines', () => {
    expect(draftItemCount([{ ...margarita, quantity: 2 }, { ...soda, quantity: 3 }])).toBe(5)
  })
})

describe('draftToPayload', () => {
  it('keeps only product ids and quantities when there are no notes', () => {
    expect(draftToPayload([{ ...margarita, quantity: 2 }, soda])).toEqual([
      { type: 'product', productId: 'p1', quantity: 2 },
      { type: 'product', productId: 'p2', quantity: 1 },
    ])
  })

  it('maps pizza lines to the pizza payload', () => {
    expect(draftToPayload([pizzaLine])).toEqual([{ type: 'pizza', pizza: config, quantity: 1 }])
  })

  it('includes trimmed notes only when not blank', () => {
    expect(
      draftToPayload([
        { ...margarita, notes: '  sin cebolla ' },
        { ...pizzaLine, notes: 'bien cocida' },
        { ...soda, notes: '   ' },
      ]),
    ).toEqual([
      { type: 'product', productId: 'p1', quantity: 1, notes: 'sin cebolla' },
      { type: 'pizza', pizza: config, quantity: 1, notes: 'bien cocida' },
      { type: 'product', productId: 'p2', quantity: 1 },
    ])
  })
})
