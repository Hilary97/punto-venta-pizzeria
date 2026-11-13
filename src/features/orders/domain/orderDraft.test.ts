import { describe, expect, it } from 'vitest'
import type { PizzaConfig } from '../../pizza/domain/pizza'
import {
  addPizzaToDraft,
  addToDraft,
  decrementDraftLine,
  draftItemCount,
  draftToPayload,
  incrementDraftLine,
  pizzaQuantity,
  productQuantity,
  removeDraftLine,
  removePizzaFromDraft,
  removeProductFromDraft,
  restoreDraftLine,
  setDraftLineNotes,
} from './orderDraft'
import type { DraftLine } from './orderDraft'

const margarita: DraftLine = { lineId: 'l1', kind: 'product', productId: 'p1', name: 'Pizza Margarita', quantity: 1, notes: '', variant: null }
const soda: DraftLine = { lineId: 'l2', kind: 'product', productId: 'p2', name: 'Refresco', quantity: 1, notes: '', variant: null }
const config: PizzaConfig = {
  size: 'grande',
  portions: [{ styleId: 's1', ingredientIds: [], extraIngredientIds: [] }],
  extraIds: [],
}
const pizzaLine: DraftLine = { lineId: 'l3', kind: 'pizza', pizza: config, name: 'Pizza Grande: Varas', quantity: 1, notes: '' }

describe('addToDraft', () => {
  it('stores the variant on a new line and keeps the base name', () => {
    expect(addToDraft([], { lineId: 'l1', productId: 'b1', name: 'Monster', variant: 'Pollo' })).toEqual([
      { lineId: 'l1', kind: 'product', productId: 'b1', name: 'Monster', quantity: 1, notes: '', variant: 'Pollo' },
    ])
  })

  it('merges only lines with the same variant', () => {
    const res = addToDraft([], { lineId: 'a', productId: 'b1', name: 'Monster', variant: 'Res' })
    const both = addToDraft(res, { lineId: 'b', productId: 'b1', name: 'Monster', variant: 'Pollo' })
    expect(both.map((l) => l.lineId)).toEqual(['a', 'b'])
    const merged = addToDraft(both, { lineId: 'c', productId: 'b1', name: 'Monster', variant: 'Pollo' })
    expect(merged.map((l) => [l.lineId, l.quantity])).toEqual([['a', 1], ['b', 2]])
  })

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
  it('emits the variant only when set', () => {
    const line: DraftLine = { ...margarita, productId: 'b1', variant: 'Res' }
    expect(draftToPayload([line, soda])).toEqual([
      { type: 'product', productId: 'b1', quantity: 1, variant: 'Res' },
      { type: 'product', productId: 'p2', quantity: 1 },
    ])
  })

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

describe('productQuantity and pizzaQuantity', () => {
  const res: DraftLine = { ...margarita, lineId: 'r', productId: 'b', variant: 'Res', quantity: 2 }
  const pollo: DraftLine = { ...margarita, lineId: 'p', productId: 'b', variant: 'Pollo', quantity: 1 }
  const noted: DraftLine = { ...res, lineId: 'n', notes: 'sin cebolla', quantity: 3 }

  it('adds up a product across variants and notes, or one variant only', () => {
    const draft = [res, pollo, noted, soda]
    expect(productQuantity(draft, 'b')).toBe(6)
    expect(productQuantity(draft, 'b', 'Res')).toBe(5)
    expect(productQuantity(draft, 'b', 'Pollo')).toBe(1)
    expect(productQuantity(draft, 'p2')).toBe(1)
    expect(productQuantity(draft, 'missing')).toBe(0)
  })

  it('does not count pizza lines as products', () => {
    expect(productQuantity([pizzaLine], 'p1')).toBe(0)
  })

  it('counts the pizzas in the draft', () => {
    expect(pizzaQuantity([res, pizzaLine, { ...pizzaLine, lineId: 'l4', quantity: 2 }])).toBe(3)
    expect(pizzaQuantity([res])).toBe(0)
  })
})

describe('restoreDraftLine', () => {
  it('puts a removed line back at its old position with its quantity and note', () => {
    const noted: DraftLine = { ...soda, quantity: 3, notes: 'sin hielo' }
    const draft = [margarita, noted, pizzaLine]
    const index = draft.indexOf(noted)
    const without = removeDraftLine(draft, noted.lineId)
    expect(restoreDraftLine(without, noted, index)).toEqual(draft)
  })

  it('clamps the position to the end and ignores a line that is already back', () => {
    expect(restoreDraftLine([margarita], soda, 5)).toEqual([margarita, soda])
    expect(restoreDraftLine([margarita, soda], soda, 0)).toEqual([margarita, soda])
  })
})

describe('removeProductFromDraft', () => {
  it('takes one unit off the matching product and drops the line at zero', () => {
    const two = [{ ...margarita, quantity: 2 }, soda]
    const one = removeProductFromDraft(two, 'p1', null)
    expect(one).toEqual([margarita, soda])
    expect(removeProductFromDraft(one, 'p1', null)).toEqual([soda])
  })

  it('only touches the given variant and takes from the most recent line', () => {
    const res: DraftLine = { ...margarita, lineId: 'a', productId: 'b1', variant: 'Res' }
    const pollo: DraftLine = { ...margarita, lineId: 'b', productId: 'b1', variant: 'Pollo' }
    const polloNote: DraftLine = { ...pollo, lineId: 'c', notes: 'sin cebolla' }
    expect(removeProductFromDraft([res, pollo, polloNote], 'b1', 'Pollo').map((l) => l.lineId)).toEqual(['a', 'b'])
  })

  it('leaves the draft unchanged when the product is not in it', () => {
    const draft = [margarita, pizzaLine]
    expect(removeProductFromDraft(draft, 'zz', null)).toBe(draft)
  })
})

describe('removePizzaFromDraft', () => {
  const other: PizzaConfig = { ...config, size: 'chica' }

  it('takes one unit off the most recent identical pizza and drops the line at zero', () => {
    let draft = addPizzaToDraft([], { lineId: 'a', pizza: config, name: 'Grande', notes: '' })
    draft = addPizzaToDraft(draft, { lineId: 'b', pizza: other, name: 'Chica', notes: '' })
    draft = addPizzaToDraft(draft, { lineId: 'c', pizza: { ...config }, name: 'Grande', notes: 'bien cocida' })

    const once = removePizzaFromDraft(draft, config)
    expect(once.map((line) => line.lineId)).toEqual(['a', 'b'])
    expect(removePizzaFromDraft(once, config).map((line) => line.lineId)).toEqual(['b'])
  })

  it('leaves the draft unchanged when that pizza is not in it', () => {
    const draft = addPizzaToDraft([margarita], { lineId: 'b', pizza: other, name: 'Chica', notes: '' })
    expect(removePizzaFromDraft(draft, config)).toBe(draft)
  })
})
