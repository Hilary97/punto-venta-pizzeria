import { describe, expect, it } from 'vitest'
import { pizzaLabelLayout } from './pizza'
import { toggleNoteShortcut } from './pizzaBuilder'

describe('portion note layout and shortcuts', () => {
  it('keeps each note on its portion next to an Extras section and with , + : in the note', () => {
    expect(pizzaLabelLayout("Pizza Grande · Mitades: ½ Estilo Varas — a | ½ Estilo Chuy's — b, c + d · Extras: Extra queso").groups).toEqual([
      { name: '½ Estilo Varas', items: [], note: 'a' },
      { name: "½ Estilo Chuy's", items: [], note: 'b, c + d' },
      { name: 'Extras', items: ['Extra queso'] },
    ])
    expect(
      pizzaLabelLayout('Pizza Grande · Mitades: ½ Estilo Mexicana (Morrón y jalapeño) — sin x | ½ Arma tu combinación (Extra Jamón) + Chorizo — poca: sal').groups[1],
    ).toEqual({ name: '½ Arma tu combinación', items: ['Extra Jamón', 'Chorizo'], note: 'poca: sal' })
  })

  it('removes a shortcut from the middle and never matches a longer entry', () => {
    expect(toggleNoteShortcut('a, Sin cebolla, b', 'Sin cebolla', 80)).toBe('a, b')
    expect(toggleNoteShortcut('Sin cebollas', 'Sin cebolla', 80)).toBe('Sin cebollas, Sin cebolla')
    expect(toggleNoteShortcut('x'.repeat(70), 'Sin cebolla', 80)).toBe('x'.repeat(70))
  })
})
