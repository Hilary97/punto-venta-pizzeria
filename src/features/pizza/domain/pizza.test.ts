import { describe, expect, it } from 'vitest'
import { describePizza, portionLabel, validatePizzaConfig } from './pizza'
import type { PizzaCatalog, PizzaConfig, PizzaPortion } from './pizza'

const catalog: PizzaCatalog = {
  sizes: [
    { code: 'chica', name: 'Chica', allowedPortions: [1, 2], sortOrder: 1 },
    { code: 'mediana', name: 'Mediana', allowedPortions: [1, 2, 3], sortOrder: 2 },
    { code: 'grande', name: 'Grande', allowedPortions: [1, 2, 3, 4], sortOrder: 3 },
  ],
  styles: [
    { id: 'varas', name: 'Estilo Varas', description: '', kind: 'special', includedIngredients: 0, sortOrder: 1 },
    { id: 'chuys', name: "Estilo Chuy's", description: '', kind: 'special', includedIngredients: 0, sortOrder: 2 },
    { id: 'custom', name: 'Arma tu pizza', description: '', kind: 'custom', includedIngredients: 2, sortOrder: 3 },
  ],
  ingredients: [
    { id: 'pep', name: 'Pepperoni', sortOrder: 1 },
    { id: 'jal', name: 'Jalapeños', sortOrder: 2 },
    { id: 'pina', name: 'Piña', sortOrder: 3 },
  ],
}

function portion(overrides: Partial<PizzaPortion> & { styleId: string }): PizzaPortion {
  return { ingredientIds: [], extraIngredientIds: [], extraCheese: false, ...overrides }
}

describe('portionLabel', () => {
  it('names the split', () => {
    expect(portionLabel(1)).toBe('Entera')
    expect(portionLabel(2)).toBe('Mitades')
    expect(portionLabel(3)).toBe('Tercios')
    expect(portionLabel(4)).toBe('Cuartos')
  })
})

describe('describePizza', () => {
  it('describes a whole special pizza without a fraction', () => {
    const config: PizzaConfig = { size: 'grande', portions: [portion({ styleId: 'varas' })] }
    expect(describePizza(config, catalog)).toBe('Pizza Grande: Estilo Varas')
  })

  it('describes halves with extras and extra cheese', () => {
    const config: PizzaConfig = {
      size: 'grande',
      portions: [
        portion({ styleId: 'varas', extraIngredientIds: ['jal'] }),
        portion({ styleId: 'chuys', extraCheese: true }),
      ],
    }
    expect(describePizza(config, catalog)).toBe(
      "Pizza Grande · Mitades: ½ Estilo Varas + Jalapeños | ½ Estilo Chuy's + Extra queso",
    )
  })

  it('lists chosen ingredients in catalog order and extras after them', () => {
    const config: PizzaConfig = {
      size: 'mediana',
      portions: [
        portion({ styleId: 'custom', ingredientIds: ['jal', 'pep'], extraIngredientIds: ['pina', 'jal'], extraCheese: true }),
        portion({ styleId: 'varas' }),
        portion({ styleId: 'varas' }),
      ],
    }
    expect(describePizza(config, catalog)).toBe(
      'Pizza Mediana · Tercios: ⅓ Arma tu pizza (Pepperoni, Jalapeños) + Jalapeños, Piña + Extra queso | ⅓ Estilo Varas | ⅓ Estilo Varas',
    )
  })

  it('uses quarters', () => {
    const config: PizzaConfig = { size: 'grande', portions: Array.from({ length: 4 }, () => portion({ styleId: 'varas' })) }
    expect(describePizza(config, catalog)).toContain('Cuartos: ¼ Estilo Varas | ¼ Estilo Varas')
  })
})

describe('validatePizzaConfig', () => {
  it('accepts a valid config', () => {
    const config: PizzaConfig = {
      size: 'chica',
      portions: [portion({ styleId: 'custom', ingredientIds: ['pep'] }), portion({ styleId: 'varas' })],
    }
    expect(validatePizzaConfig(config, catalog)).toEqual([])
  })

  it('rejects an unknown size', () => {
    const config = { size: 'xl', portions: [portion({ styleId: 'varas' })] } as unknown as PizzaConfig
    expect(validatePizzaConfig(config, catalog)).toEqual(['Tamaño de pizza inválido.'])
  })

  it('rejects a portion count the size does not allow', () => {
    const config: PizzaConfig = { size: 'chica', portions: Array.from({ length: 3 }, () => portion({ styleId: 'varas' })) }
    expect(validatePizzaConfig(config, catalog)).toEqual(['La pizza Chica no se puede dividir en 3 porciones.'])
  })

  it('rejects an empty portion list', () => {
    expect(validatePizzaConfig({ size: 'chica', portions: [] }, catalog)).toEqual([
      'La configuración de la pizza es inválida.',
    ])
  })

  it('rejects unknown styles', () => {
    const config: PizzaConfig = { size: 'chica', portions: [portion({ styleId: 'nope' })] }
    expect(validatePizzaConfig(config, catalog)).toEqual(['Uno de los estilos no existe o no está activo.'])
  })

  it('rejects ingredients on special styles', () => {
    const config: PizzaConfig = { size: 'chica', portions: [portion({ styleId: 'varas', ingredientIds: ['pep'] })] }
    expect(validatePizzaConfig(config, catalog)).toEqual(['Estilo Varas ya incluye sus ingredientes.'])
  })

  it('requires 1..included ingredients on custom styles', () => {
    const none: PizzaConfig = { size: 'chica', portions: [portion({ styleId: 'custom' })] }
    expect(validatePizzaConfig(none, catalog)).toEqual(['Elige al menos un ingrediente para Arma tu pizza.'])
    const many: PizzaConfig = {
      size: 'chica',
      portions: [portion({ styleId: 'custom', ingredientIds: ['pep', 'jal', 'pina'] })],
    }
    expect(validatePizzaConfig(many, catalog)).toEqual(['Arma tu pizza incluye hasta 2 ingredientes.'])
  })

  it('rejects more than 10 extras, duplicates and unknown ingredients', () => {
    const tooMany: PizzaConfig = {
      size: 'chica',
      portions: [portion({ styleId: 'varas', extraIngredientIds: Array.from({ length: 11 }, (_, i) => `x${i}`) })],
    }
    expect(validatePizzaConfig(tooMany, catalog)).toEqual(['Máximo 10 ingredientes extra por porción.'])

    const dup: PizzaConfig = { size: 'chica', portions: [portion({ styleId: 'varas', extraIngredientIds: ['pep', 'pep'] })] }
    expect(validatePizzaConfig(dup, catalog)).toEqual(['Los ingredientes de una porción no se pueden repetir.'])

    const unknown: PizzaConfig = { size: 'chica', portions: [portion({ styleId: 'varas', extraIngredientIds: ['zzz'] })] }
    expect(validatePizzaConfig(unknown, catalog)).toEqual(['Uno de los ingredientes no existe o no está activo.'])
  })
})
