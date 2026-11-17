import { describe, expect, it } from 'vitest'
import type { PizzaCatalog } from '../../pizza/domain/pizza'
import { describePizza } from '../../pizza/domain/pizza'
import type { VoiceContext, VoiceLine } from './voiceOrder'
import { parseSpokenOrder } from './voiceOrder'

const CATALOG: PizzaCatalog = {
  sizes: [
    { code: 'chica', name: 'Chica', allowedPortions: [1, 2], sortOrder: 1, doughLeft: null },
    { code: 'mediana', name: 'Mediana', allowedPortions: [1, 2], sortOrder: 2, doughLeft: null },
    { code: 'grande', name: 'Grande', allowedPortions: [1, 2, 3, 4], sortOrder: 3, doughLeft: null },
  ],
  styles: [
    { id: 'pep', name: 'Estilo Pepperoni', description: '', kind: 'special', includedIngredients: 0, sortOrder: 1 },
    { id: 'varas', name: 'Estilo Varas', description: '', kind: 'special', includedIngredients: 0, sortOrder: 2 },
    { id: 'custom', name: 'Arma tu combinación', description: '', kind: 'custom', includedIngredients: 2, sortOrder: 3 },
  ],
  ingredients: [
    { id: 'champ', name: 'Champiñones', sortOrder: 1 },
    { id: 'pina', name: 'Piña', sortOrder: 2 },
  ],
  extras: [{ id: 'queso', name: 'Extra queso', sortOrder: 1 }],
}

const CONTEXT: VoiceContext = {
  products: [
    { id: 'coca600', name: 'Coca-Cola 600 ml', variants: [] },
    { id: 'coca2l', name: 'Coca-Cola 2 litros', variants: [] },
    { id: 'agua', name: 'Agua embotellada 600 ml', variants: [] },
    { id: 'alitas', name: 'Alitas 5 pzas', variants: ['Búfalo', 'BBQ', 'Mango-Habanero'] },
    { id: 'monster', name: 'Hamburguesa Monster doble carne - con papas gajo', variants: ['Res', 'Pollo'] },
    { id: 'aros', name: 'Aros de cebolla 10 pzas', variants: [] },
  ],
  pizzaCatalog: CATALOG,
}

/** Unambiguous catalog: one Coca-Cola, one product with variants, one without. */
const SIMPLE: VoiceContext = {
  products: [
    { id: 'coca', name: 'Coca-Cola 600 ml', variants: [] },
    { id: 'alitas', name: 'Alitas 5 pzas', variants: ['Búfalo', 'BBQ'] },
    { id: 'aros', name: 'Aros de cebolla 10 pzas', variants: [] },
  ],
  pizzaCatalog: CATALOG,
}

function parse(text: string, context: VoiceContext = SIMPLE): VoiceLine[] {
  return parseSpokenOrder(text, context)
}

function only(lines: VoiceLine[]): VoiceLine {
  expect(lines).toHaveLength(1)
  return lines[0] as VoiceLine
}

const pizzaLine = (size: 'chica' | 'mediana' | 'grande', styleId: string): VoiceLine['kind'] extends never ? never : object => ({
  kind: 'pizza',
  pizza: { size, portions: [{ styleId, ingredientIds: [], extraIngredientIds: [] }], extraIds: [] },
})

describe('parseSpokenOrder quantities', () => {
  it('reads a number word and singular/plural, and defaults to one', () => {
    expect(only(parse('dos cocas'))).toMatchObject({ kind: 'product', productId: 'coca', quantity: 2 })
    expect(only(parse('coca'))).toMatchObject({ kind: 'product', productId: 'coca', quantity: 1 })
    expect(only(parse('doce cocas'))).toMatchObject({ kind: 'product', productId: 'coca', quantity: 12 })
  })

  it('reads digits, 2x and a trailing xN', () => {
    expect(only(parse('3 cocas'))).toMatchObject({ productId: 'coca', quantity: 3 })
    expect(only(parse('2x coca'))).toMatchObject({ productId: 'coca', quantity: 2 })
    expect(only(parse('coca x4'))).toMatchObject({ productId: 'coca', quantity: 4 })
  })

  it('splits one order into lines by comma, semicolon, " y ", " más " and newline', () => {
    const lines = parse('2 cocas, 3 aros y 1 alitas búfalo; coca\naros')
    expect(lines.map((line) => `${line.kind}:${line.heard}`)).toEqual([
      'product:2 cocas',
      'product:3 aros',
      'product:1 alitas búfalo',
      'product:coca',
      'product:aros',
    ])
    expect(lines.map((line) => ('quantity' in line ? line.quantity : 0))).toEqual([2, 3, 1, 1, 1])
  })

  it('returns nothing for blank text', () => {
    expect(parse('   ')).toEqual([])
    expect(parse('')).toEqual([])
  })
})

describe('parseSpokenOrder products', () => {
  it('ignores accents and case', () => {
    const withAccents: VoiceContext = { ...SIMPLE, products: [{ id: 'pina', name: 'Agua de Piña', variants: [] }] }
    expect(only(parse('un AGUA DE PINA', withAccents))).toMatchObject({ kind: 'product', productId: 'pina' })
  })

  it('matches a product by its first word when only one product starts that way', () => {
    expect(only(parse('unos aros'))).toMatchObject({ productId: 'aros', quantity: 1 })
  })

  it('asks instead of guessing when several products match', () => {
    const line = only(parse('2 cocas', CONTEXT))
    expect(line).toMatchObject({ kind: 'pickProduct', quantity: 2 })
    if (line.kind !== 'pickProduct') throw new Error('expected pickProduct')
    expect(line.options.map((option) => option.productId).sort()).toEqual(['coca2l', 'coca600'])
  })

  it('sets the variant named in the dictation', () => {
    expect(only(parse('1 alitas bbq'))).toMatchObject({ kind: 'product', productId: 'alitas', variant: 'BBQ' })
  })

  it('asks for the variant when the product has some and none was named', () => {
    const line = only(parse('2 alitas'))
    expect(line).toMatchObject({ kind: 'missingVariant', productId: 'alitas' })
    if (line.kind !== 'missingVariant') throw new Error('expected missingVariant')
    expect(line.options).toEqual(['Búfalo', 'BBQ'])
  })

  it('keeps the leftover words as a proposed note, never as a silent drop', () => {
    const monsters: VoiceContext = { ...SIMPLE, products: [{ id: 'monster', name: 'Hamburguesa Monster', variants: ['Res', 'Pollo'] }] }
    expect(only(parse('una hamburguesa monster de res sin cebolla', monsters))).toMatchObject({
      kind: 'product',
      productId: 'monster',
      variant: 'Res',
      notes: 'sin cebolla',
    })
  })

  it('does not turn filler words into notes', () => {
    expect(only(parse('dame una coca por favor'))).toMatchObject({ kind: 'product', productId: 'coca', notes: '' })
  })
})

describe('parseSpokenOrder pizzas', () => {
  it('builds a whole pizza from a size and a style named without the Estilo prefix', () => {
    const line = only(parse('una grande de pepperoni'))
    expect(line).toMatchObject(pizzaLine('grande', 'pep'))
    expect(line).toMatchObject({ quantity: 1 })
    if (line.kind !== 'pizza') throw new Error('expected pizza')
    expect(line.name).toBe(describePizza(line.pizza, CATALOG))
    expect(line.name).toBe('Pizza Grande: Estilo Pepperoni')
  })

  it('reads the size and style in any order, with or without the word pizza', () => {
    expect(only(parse('pizza varas mediana'))).toMatchObject(pizzaLine('mediana', 'varas'))
    expect(only(parse('2 pizzas chicas de pepperoni'))).toMatchObject({ ...pizzaLine('chica', 'pep'), quantity: 2 })
  })

  it('asks for the style when only the size was said', () => {
    const line = only(parse('una grande'))
    expect(line).toMatchObject({ kind: 'unknown' })
    if (line.kind !== 'unknown') throw new Error('expected unknown')
    expect(line.heard).toBe('una grande')
    expect(line.reason).toMatch(/estilo/i)
  })

  it('sends halves, ingredients and extras to the builder instead of guessing', () => {
    for (const text of ['mitad varas mitad pepperoni', 'una grande de pepperoni con champiñones', 'una grande de varas con extra queso']) {
      const line = only(parse(text))
      expect(line).toMatchObject({ kind: 'unknown', heard: text })
      if (line.kind !== 'unknown') throw new Error('expected unknown')
      expect(line.reason).toMatch(/Armar pizza/)
    }
  })
})

describe('parseSpokenOrder unknown text', () => {
  it('returns what it heard and why it could not use it', () => {
    const line = only(parse('dos tacos de canasta'))
    expect(line).toMatchObject({ kind: 'unknown', heard: 'dos tacos de canasta' })
    if (line.kind !== 'unknown') throw new Error('expected unknown')
    expect(line.reason).toMatch(/No reconocí/)
  })

  it('accounts for every segment of the dictation', () => {
    const lines = parse('2 cocas y dos tacos de canasta y 1 aros', CONTEXT)
    expect(lines).toHaveLength(3)
    expect(lines.map((line) => line.kind)).toEqual(['pickProduct', 'unknown', 'product'])
  })

  it('never mutates or needs anything but the text and the catalog', () => {
    const first = parse('2 cocas y una grande de pepperoni', CONTEXT)
    const second = parse('2 cocas y una grande de pepperoni', CONTEXT)
    expect(second).toEqual(first)
    expect(CONTEXT.products).toHaveLength(6)
  })
})
