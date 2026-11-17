import { describe, expect, it } from 'vitest'
import type { PizzaConfig } from '../../pizza/domain/pizza'
import type { DraftLine } from './orderDraft'
import { addToDraft, addVoiceLines, productQuantity } from './orderDraft'

function ids(): () => string {
  let next = 0
  return () => `voice-${++next}`
}

const PLAIN_COCA: DraftLine = { lineId: 'line-1', kind: 'product', productId: 'coca', name: 'Coca-Cola 600 ml', variant: null, quantity: 1, notes: '' }

describe('addVoiceLines', () => {
  it('merges into an existing plain line of the same product when the line has no note', () => {
    const draft = addVoiceLines([PLAIN_COCA], [{ kind: 'product', productId: 'coca', name: 'Coca-Cola 600 ml', variant: null, quantity: 2, notes: '' }], ids())
    expect(draft).toHaveLength(1)
    expect(productQuantity(draft, 'coca')).toBe(3)
  })

  it('keeps the note and the full quantity when an existing plain line would have swallowed it', () => {
    const draft = addVoiceLines(
      [PLAIN_COCA],
      [{ kind: 'product', productId: 'coca', name: 'Coca-Cola 600 ml', variant: null, quantity: 3, notes: 'sin hielo' }],
      ids(),
    )
    expect(draft).toHaveLength(2)
    expect(draft[0]).toEqual(PLAIN_COCA)
    expect(draft[1]).toMatchObject({ kind: 'product', productId: 'coca', quantity: 3, notes: 'sin hielo' })
    expect(productQuantity(draft, 'coca')).toBe(4)
  })

  it('uses the variant as part of the identity', () => {
    const draft = addVoiceLines(
      [PLAIN_COCA],
      [{ kind: 'product', productId: 'coca', name: 'Coca-Cola 600 ml', variant: 'Vidrio', quantity: 1, notes: '' }],
      ids(),
    )
    expect(draft).toHaveLength(2)
    expect(productQuantity(draft, 'coca', 'Vidrio')).toBe(1)
  })

  it('adds one pizza line per unit and never merges pizzas', () => {
    const pizza: PizzaConfig = { size: 'grande', portions: [{ styleId: 'pep', ingredientIds: [], extraIngredientIds: [] }], extraIds: [] }
    const draft = addVoiceLines([], [{ kind: 'pizza', pizza, name: 'Pizza Grande: Estilo Pepperoni', quantity: 2, notes: '' }], ids())
    expect(draft).toHaveLength(2)
    expect(draft.every((line) => line.kind === 'pizza' && line.quantity === 1)).toBe(true)
  })

  it('keeps every line of a batch, in order, with unique ids', () => {
    const draft = addVoiceLines(
      [],
      [
        { kind: 'product', productId: 'coca', name: 'Coca-Cola 600 ml', variant: null, quantity: 2, notes: '' },
        { kind: 'product', productId: 'aros', name: 'Aros de cebolla 10 pzas', variant: null, quantity: 1, notes: '' },
      ],
      ids(),
    )
    expect(draft.map((line) => (line.kind === 'product' ? line.productId : 'pizza'))).toEqual(['coca', 'aros'])
    expect(new Set(draft.map((line) => line.lineId)).size).toBe(draft.length)
  })

  it('leaves the draft unchanged for an empty batch', () => {
    const draft = [PLAIN_COCA]
    expect(addVoiceLines(draft, [], ids())).toBe(draft)
  })
})

describe('addToDraft versus a dictated line (the bug this helper fixes)', () => {
  it('would have merged and lost the note when the generated id is reused', () => {
    const merged = addToDraft([PLAIN_COCA], { lineId: 'voice-1', productId: 'coca', name: 'Coca-Cola 600 ml', variant: null })
    expect(merged).toHaveLength(1)
    expect(merged.some((line) => line.lineId === 'voice-1' && line.notes === 'sin hielo')).toBe(false)
  })
})
