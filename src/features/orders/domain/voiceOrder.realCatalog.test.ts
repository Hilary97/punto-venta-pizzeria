import { describe, expect, it } from 'vitest'
import type { PizzaCatalog } from '../../pizza/domain/pizza'
import { parseSpokenOrder, type VoiceContext } from './voiceOrder'

const CAT: PizzaCatalog = {
  sizes: [
    { code: 'chica', name: 'Chica', allowedPortions: [1], sortOrder: 1, doughLeft: null },
    { code: 'mediana', name: 'Mediana', allowedPortions: [1, 2], sortOrder: 2, doughLeft: null },
    { code: 'grande', name: 'Grande', allowedPortions: [1, 2, 3, 4], sortOrder: 3, doughLeft: null },
  ],
  styles: [{ id: 'pep', name: 'Estilo Pepperoni', description: '', kind: 'special', includedIngredients: 0, sortOrder: 16 }],
  ingredients: ['Pepperoni', 'Cebolla', 'Piña'].map((name, i) => ({ id: `i${i}`, name, sortOrder: i })),
  extras: [{ id: 'queso', name: 'Extra queso', sortOrder: 1 }],
}
const CTX: VoiceContext = {
  products: [
    { id: 'coca600', name: 'Coca-Cola 600 ml', variants: [] },
    { id: 'coca15', name: 'Coca-Cola 1.5 L', variants: [] },
    { id: 'aros', name: 'Aros de cebolla 10 pzas', variants: [] },
  ],
  pizzaCatalog: CAT,
}

describe('voice parser against real seed shapes', () => {
  it('S1/S7: builds the flagship pizza although its style name is also an ingredient', () => {
    expect(parseSpokenOrder('dos cocas y una grande de pepperoni', CTX).map((l) => l.kind)).toEqual(['pickProduct', 'pizza'])
    const only = parseSpokenOrder('una grande de pepperoni', CTX)
    expect(only).toHaveLength(1)
    expect(only[0]).toMatchObject({ kind: 'pizza', quantity: 1, name: 'Pizza Grande: Estilo Pepperoni' })
  })
  it('S5: splits on accented "más"', () => {
    const lines = parseSpokenOrder('dos cocas más una grande de pepperoni', CTX)
    expect(lines.map((l) => l.kind)).toEqual(['pickProduct', 'pizza'])
    expect(lines[1]).toMatchObject({ kind: 'pizza', quantity: 1 })
  })
  it('S5: a decomposed (NFD) \u00e1 splits the same as the precomposed one', () => {
    const decomposed = 'dos cocas ma\u0301s una grande de pepperoni'.normalize('NFD')
    expect(parseSpokenOrder(decomposed, CTX).map((l) => l.kind)).toEqual(['pickProduct', 'pizza'])
  })
  it('S6: an ingredient word inside a product name does not divert it to the pizza builder', () => {
    for (const text of ['2 aros sin cebolla', 'dos aros de cebolla']) {
      const lines = parseSpokenOrder(text, CTX)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatchObject({ kind: 'product', productId: 'aros', quantity: 2 })
    }
  })
})
