import { describe, expect, it } from 'vitest'
import { MAX_EXTRA_INGREDIENTS } from './pizza'
import type { PizzaPortion, PizzaSize, PizzaStyle } from './pizza'
import {
  buildConfig,
  initialPortions,
  resizePortions,
  setPortionStyle,
  toggleExtra,
  toggleExtraCheese,
  toggleIngredient,
} from './pizzaBuilder'

const special: PizzaStyle = { id: 'varas', name: 'Varas', description: '', kind: 'special', includedIngredients: 0, sortOrder: 1 }
const custom: PizzaStyle = { id: 'custom', name: 'Arma', description: '', kind: 'custom', includedIngredients: 2, sortOrder: 2 }
const chica: PizzaSize = { code: 'chica', name: 'Chica', allowedPortions: [1, 2], sortOrder: 1 }

const empty: PizzaPortion = { styleId: 'varas', ingredientIds: [], extraIngredientIds: [], extraCheese: false }

describe('initialPortions', () => {
  it('creates the requested number of unset portions', () => {
    const portions = initialPortions(2, 'varas')
    expect(portions).toHaveLength(2)
    expect(portions[0]).toEqual(empty)
    expect(portions[0]).not.toBe(portions[1])
  })
})

describe('resizePortions', () => {
  it('keeps the current division when the new size allows it', () => {
    const portions = [empty, { ...empty, styleId: 'x' }]
    expect(resizePortions(portions, chica, 'varas')).toBe(portions)
  })

  it('resets to a single portion when the division is not allowed', () => {
    const portions = [empty, empty, empty]
    expect(resizePortions(portions, chica, 'varas')).toEqual([empty])
  })
})

describe('setPortionStyle', () => {
  it('clears chosen ingredients when switching to a special style', () => {
    const portion = { ...empty, styleId: 'custom', ingredientIds: ['a'], extraIngredientIds: ['b'] }
    expect(setPortionStyle(portion, special)).toEqual({ ...empty, styleId: 'varas', extraIngredientIds: ['b'] })
  })

  it('keeps ingredients up to the custom limit', () => {
    const portion = { ...empty, ingredientIds: [] }
    expect(setPortionStyle(portion, custom).styleId).toBe('custom')
    expect(setPortionStyle({ ...portion, styleId: 'custom', ingredientIds: ['a', 'b', 'c'] }, { ...custom, includedIngredients: 1 }).ingredientIds).toEqual(['a'])
  })
})

describe('toggleIngredient', () => {
  it('adds and removes ingredients', () => {
    const added = toggleIngredient(empty, 'a', custom)
    expect(added.ingredientIds).toEqual(['a'])
    expect(toggleIngredient(added, 'a', custom).ingredientIds).toEqual([])
  })

  it('ignores additions beyond the included limit', () => {
    const full = { ...empty, ingredientIds: ['a', 'b'] }
    expect(toggleIngredient(full, 'c', custom)).toBe(full)
  })

  it('does not touch extras, since an included ingredient may also be an extra', () => {
    const portion = { ...empty, extraIngredientIds: ['a'] }
    expect(toggleIngredient(portion, 'a', custom)).toMatchObject({ ingredientIds: ['a'], extraIngredientIds: ['a'] })
  })
})

describe('toggleExtra', () => {
  it('adds and removes extras', () => {
    const added = toggleExtra(empty, 'a')
    expect(added.extraIngredientIds).toEqual(['a'])
    expect(toggleExtra(added, 'a').extraIngredientIds).toEqual([])
  })

  it('ignores additions beyond the extras limit', () => {
    const ids = Array.from({ length: MAX_EXTRA_INGREDIENTS }, (_, i) => `i${i}`)
    const full = { ...empty, extraIngredientIds: ids }
    expect(toggleExtra(full, 'new')).toBe(full)
  })
})

describe('toggleExtraCheese', () => {
  it('flips the flag', () => {
    expect(toggleExtraCheese(empty).extraCheese).toBe(true)
    expect(toggleExtraCheese({ ...empty, extraCheese: true }).extraCheese).toBe(false)
  })
})

describe('buildConfig', () => {
  it('combines size and portions', () => {
    expect(buildConfig('chica', [empty])).toEqual({ size: 'chica', portions: [empty] })
  })
})
