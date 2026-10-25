import { MAX_EXTRA_INGREDIENTS } from './pizza'
import type { PizzaConfig, PizzaPortion, PizzaSize, PizzaSizeCode, PizzaStyle } from './pizza'

/*
 * Pure state helpers behind the pizza builder UI. The server stays authoritative:
 * these only keep the builder state inside what `validatePizzaConfig` accepts.
 */

function emptyPortion(styleId: string): PizzaPortion {
  return { styleId, ingredientIds: [], extraIngredientIds: [], extraIds: [] }
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

/** Toggles an extra ingredient, capped at `MAX_EXTRA_INGREDIENTS`. */
export function toggleExtra(portion: PizzaPortion, ingredientId: string): PizzaPortion {
  if (portion.extraIngredientIds.includes(ingredientId)) {
    return { ...portion, extraIngredientIds: portion.extraIngredientIds.filter((id) => id !== ingredientId) }
  }
  if (portion.extraIngredientIds.length >= MAX_EXTRA_INGREDIENTS) return portion
  return { ...portion, extraIngredientIds: [...portion.extraIngredientIds, ingredientId] }
}

/** Toggles a per-portion extra such as Extra queso. */
export function togglePizzaExtra(portion: PizzaPortion, extraId: string): PizzaPortion {
  if (portion.extraIds.includes(extraId)) {
    return { ...portion, extraIds: portion.extraIds.filter((id) => id !== extraId) }
  }
  return { ...portion, extraIds: [...portion.extraIds, extraId] }
}

export function buildConfig(size: PizzaSizeCode, portions: PizzaPortion[]): PizzaConfig {
  return { size, portions }
}
