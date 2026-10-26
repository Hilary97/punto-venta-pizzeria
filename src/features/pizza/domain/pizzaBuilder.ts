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

/** Switches the portion style; special styles carry their own ingredients, so picks are cleared. */
export function setPortionStyle(portion: PizzaPortion, style: PizzaStyle): PizzaPortion {
  const ingredientIds = style.kind === 'special' ? [] : portion.ingredientIds.slice(0, style.includedIngredients)
  return { ...portion, styleId: style.id, ingredientIds }
}

/** Toggles an included ingredient of a custom style, capped at the style limit. */
export function toggleIngredient(portion: PizzaPortion, ingredientId: string, style: PizzaStyle): PizzaPortion {
  if (portion.ingredientIds.includes(ingredientId)) {
    return { ...portion, ingredientIds: portion.ingredientIds.filter((id) => id !== ingredientId) }
  }
  if (portion.ingredientIds.length >= style.includedIngredients) return portion
  return { ...portion, ingredientIds: [...portion.ingredientIds, ingredientId] }
}

/** Toggles an extra ingredient; there is no limit, each one is charged. */
export function toggleExtra(portion: PizzaPortion, ingredientId: string): PizzaPortion {
  if (portion.extraIngredientIds.includes(ingredientId)) {
    return { ...portion, extraIngredientIds: portion.extraIngredientIds.filter((id) => id !== ingredientId) }
  }
  return { ...portion, extraIngredientIds: [...portion.extraIngredientIds, ingredientId] }
}

/** Toggles a whole-pizza extra such as Extra queso. */
export function togglePizzaExtra(extraIds: string[], extraId: string): string[] {
  if (extraIds.includes(extraId)) return extraIds.filter((id) => id !== extraId)
  return [...extraIds, extraId]
}

export function buildConfig(size: PizzaSizeCode, portions: PizzaPortion[], extraIds: string[]): PizzaConfig {
  return { size, portions, extraIds }
}
