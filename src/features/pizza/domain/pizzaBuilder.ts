import type { PizzaConfig, PizzaPortion, PizzaSize, PizzaSizeCode, PizzaStyle } from './pizza'

/*
 * Pure state helpers behind the pizza builder UI. The server stays authoritative:
 * these only keep the builder state inside what `validatePizzaConfig` accepts.
 */

function emptyPortion(styleId: string): PizzaPortion {
  return { styleId, ingredientIds: [], extraIngredientIds: [] }
}

/** `count` portions that all start with the given style. */
export function initialPortions(count: number, styleId: string): PizzaPortion[] {
  return Array.from({ length: count }, () => emptyPortion(styleId))
}

/** Keeps the division when the size allows it; otherwise falls back to a whole pizza. */
export function resizePortions(portions: PizzaPortion[], size: PizzaSize, defaultStyleId: string): PizzaPortion[] {
  if (size.allowedPortions.includes(portions.length)) return portions
  return initialPortions(1, portions[0]?.styleId ?? defaultStyleId)
}

/** Switches the portion style, keeping chosen ingredients up to the new style limit. */
export function setPortionStyle(portion: PizzaPortion, style: PizzaStyle): PizzaPortion {
  const ingredientIds = portion.ingredientIds.slice(0, style.includedIngredients)
  return { ...portion, styleId: style.id, ingredientIds }
}

/**
 * Cycles an included ingredient: included (capped at the style limit), then doubled, then removed.
 * The double is one charged extra of the same ingredient; removing it takes that extra back.
 */
export function toggleIngredient(portion: PizzaPortion, ingredientId: string, style: PizzaStyle): PizzaPortion {
  if (!portion.ingredientIds.includes(ingredientId)) {
    if (portion.ingredientIds.length >= style.includedIngredients) return portion
    return { ...portion, ingredientIds: [...portion.ingredientIds, ingredientId] }
  }
  const extras = portion.extraIngredientIds
  if (!extras.includes(ingredientId)) return { ...portion, extraIngredientIds: [...extras, ingredientId] }
  const at = extras.indexOf(ingredientId)
  return {
    ...portion,
    ingredientIds: portion.ingredientIds.filter((id) => id !== ingredientId),
    extraIngredientIds: [...extras.slice(0, at), ...extras.slice(at + 1)],
  }
}

/** Times an extra ingredient is on the portion: 0, 1 or 2 (doubled). */
export function extraCount(portion: PizzaPortion, ingredientId: string): number {
  return portion.extraIngredientIds.filter((id) => id === ingredientId).length
}

/**
 * Cycles an extra ingredient: added, then doubled (charged twice), then removed.
 * There is no limit on how many different extras a portion has; each one is charged.
 */
export function toggleExtra(portion: PizzaPortion, ingredientId: string): PizzaPortion {
  const ids = portion.extraIngredientIds
  const at = ids.indexOf(ingredientId)
  if (at === -1) return { ...portion, extraIngredientIds: [...ids, ingredientId] }
  if (extraCount(portion, ingredientId) === 1) {
    return { ...portion, extraIngredientIds: [...ids.slice(0, at + 1), ingredientId, ...ids.slice(at + 1)] }
  }
  return { ...portion, extraIngredientIds: ids.filter((id) => id !== ingredientId) }
}

/** Toggles a whole-pizza extra such as Extra queso. */
export function togglePizzaExtra(extraIds: string[], extraId: string): string[] {
  if (extraIds.includes(extraId)) return extraIds.filter((id) => id !== extraId)
  return [...extraIds, extraId]
}

export function buildConfig(size: PizzaSizeCode, portions: PizzaPortion[], extraIds: string[]): PizzaConfig {
  return { size, portions, extraIds }
}
