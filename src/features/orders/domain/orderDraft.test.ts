import { describe, expect, it } from 'vitest'
import {
  addToDraft,
  decrementDraftLine,
  draftItemCount,
  draftToPayload,
  incrementDraftLine,
  removeDraftLine,
} from './orderDraft'
import type { DraftLine } from './orderDraft'

const pizza: DraftLine = { productId: 'p1', name: 'Pizza Margarita', quantity: 1 }
const soda: DraftLine = { productId: 'p2', name: 'Refresco', quantity: 1 }

describe('addToDraft', () => {
  it('adds a new product with quantity 1', () => {
    expect(addToDraft([], { productId: 'p1', name: 'Pizza Margarita' })).toEqual([pizza])
  })

  it('increments quantity when the product already exists', () => {
    expect(addToDraft([pizza], { productId: 'p1', name: 'Pizza Margarita' })).toEqual([
      { ...pizza, quantity: 2 },
    ])
  })
})

describe('incrementDraftLine', () => {
  it('increases only the matching line', () => {
    expect(incrementDraftLine([pizza, soda], 'p2')).toEqual([pizza, { ...soda, quantity: 2 }])
  })
})

describe('decrementDraftLine', () => {
  it('decreases quantity by one', () => {
    expect(decrementDraftLine([{ ...pizza, quantity: 3 }], 'p1')).toEqual([{ ...pizza, quantity: 2 }])
  })

  it('removes the line when quantity reaches zero', () => {
    expect(decrementDraftLine([pizza, soda], 'p1')).toEqual([soda])
  })
})

describe('removeDraftLine', () => {
  it('removes the line regardless of quantity', () => {
    expect(removeDraftLine([{ ...pizza, quantity: 5 }, soda], 'p1')).toEqual([soda])
  })
})

describe('draftItemCount', () => {
  it('returns 0 for an empty draft', () => {
    expect(draftItemCount([])).toBe(0)
  })

  it('sums quantities across lines', () => {
    expect(draftItemCount([{ ...pizza, quantity: 2 }, { ...soda, quantity: 3 }])).toBe(5)
  })
})

describe('draftToPayload', () => {
  it('keeps only product ids and quantities', () => {
    expect(draftToPayload([{ ...pizza, quantity: 2 }, soda])).toEqual([
      { productId: 'p1', quantity: 2 },
      { productId: 'p2', quantity: 1 },
    ])
  })
})
