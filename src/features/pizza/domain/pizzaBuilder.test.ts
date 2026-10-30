import { describe, expect, it } from 'vitest'
import type { PizzaPortion, PizzaSize, PizzaStyle } from './pizza'
import {
  buildConfig,
  initialPortions,
  resizePortions,
  setPortionStyle,
  toggleExtra,
  toggleIngredient,
  togglePizzaExtra,
} from './pizzaBuilder'

const special: PizzaStyle = { id: 'varas', name: 'Varas', description: '', kind: 'special', includedIngredients: 0, sortOrder: 1 }
const custom: PizzaStyle = { id: 'custom', name: 'Arma', description: '', kind: 'custom', includedIngredients: 2, sortOrder: 2 }
const chica: PizzaSize = { code: 'chica', name: 'Chica', allowedPortions: [1, 2], sortOrder: 1, doughLeft: null }

const empty: PizzaPortion = { styleId: 'varas', ingredientIds: [], extraIngredientIds: [] }

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
  it('keeps chosen ingredients up to the limit when switching to a special style', () => {
    const portion = { ...empty, styleId: 'custom', ingredientIds: ['a', 'c'], extraIngredientIds: ['b'] }
    expect(setPortionStyle(portion, special)).toEqual({ ...empty, styleId: 'varas', extraIngredientIds: ['b'] })
    expect(setPortionStyle(portion, { ...special, includedIngredients: 2 })).toEqual({
      ...empty,
      styleId: 'varas',
      ingredientIds: ['a', 'c'],
      extraIngredientIds: ['b'],
    })
  })

  it('keeps ingredients up to the custom limit', () => {
    const portion = { ...empty, ingredientIds: [] }
    expect(setPortionStyle(portion, custom).styleId).toBe('custom')
    expect(setPortionStyle({ ...portion, styleId: 'custom', ingredientIds: ['a', 'b', 'c'] }, { ...custom, includedIngredients: 1 }).ingredientIds).toEqual(['a'])
  })
})

describe('toggleIngredient', () => {
  it('cycles an ingredient through included, doubled (one charged extra) and removed', () => {
    const added = toggleIngredient(empty, 'a', custom)
    expect(added).toMatchObject({ ingredientIds: ['a'], extraIngredientIds: [] })
    const doubled = toggleIngredient(added, 'a', custom)
    expect(doubled).toMatchObject({ ingredientIds: ['a'], extraIngredientIds: ['a'] })
    expect(toggleIngredient(doubled, 'a', custom)).toMatchObject({ ingredientIds: [], extraIngredientIds: [] })
  })

  it('removes an included ingredient that already has extras, taking back one of them', () => {
    const portion = { ...empty, ingredientIds: ['a', 'b'], extraIngredientIds: ['c', 'a', 'a'] }
    expect(toggleIngredient(portion, 'a', custom)).toMatchObject({ ingredientIds: ['b'], extraIngredientIds: ['c', 'a'] })
  })

  it('doubles an included ingredient even when the included limit is full', () => {
    const full = { ...empty, ingredientIds: ['a', 'b'] }
    expect(toggleIngredient(full, 'b', custom)).toMatchObject({ ingredientIds: ['a', 'b'], extraIngredientIds: ['b'] })
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
  it('cycles an extra through added, doubled and removed', () => {
    const added = toggleExtra(empty, 'a')
    expect(added.extraIngredientIds).toEqual(['a'])
    const doubled = toggleExtra(added, 'a')
    expect(doubled.extraIngredientIds).toEqual(['a', 'a'])
    expect(toggleExtra(doubled, 'a').extraIngredientIds).toEqual([])
  })

  it('doubles or removes one extra without touching the others', () => {
    const portion = { ...empty, extraIngredientIds: ['b', 'a', 'c'] }
    expect(toggleExtra(portion, 'a').extraIngredientIds).toEqual(['b', 'a', 'a', 'c'])
    expect(toggleExtra({ ...empty, extraIngredientIds: ['b', 'a', 'a', 'c'] }, 'a').extraIngredientIds).toEqual(['b', 'c'])
  })

  it('keeps adding extras with no limit', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `i${i}`)
    const many = { ...empty, extraIngredientIds: ids }
    expect(toggleExtra(many, 'new').extraIngredientIds).toEqual([...ids, 'new'])
  })
})

describe('togglePizzaExtra', () => {
  it('adds and removes an extra, keeping the others', () => {
    const withCheese = togglePizzaExtra([], 'queso')
    expect(withCheese).toEqual(['queso'])
    expect(togglePizzaExtra(withCheese, 'orilla')).toEqual(['queso', 'orilla'])
    expect(togglePizzaExtra(['queso', 'orilla'], 'queso')).toEqual(['orilla'])
  })
})

describe('buildConfig', () => {
  it('combines size and portions', () => {
    expect(buildConfig('chica', [empty], ['queso'])).toEqual({ size: 'chica', portions: [empty], extraIds: ['queso'] })
  })
})
