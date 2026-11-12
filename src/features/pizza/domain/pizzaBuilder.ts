import { byName } from '../../../shared/sortByName'
import { hasChileVariants, sortChiles, styleKey } from './pizza'
import type { ChileVariant, PizzaConfig, PizzaPortion, PizzaSize, PizzaSizeCode, PizzaStyle } from './pizza'

export { hasChileVariants }

/*
 * Pure state helpers behind the pizza builder UI. The server stays authoritative:
 * these only keep the builder state inside what `validatePizzaConfig` accepts.
 */

/** Styles the builder always lists first, in this order, matched by `styleKey`. */
const PINNED_STYLE_KEYS = ['estilopepperoni', 'estilohawaiana']

function pinRank(style: PizzaStyle): number {
  const rank = PINNED_STYLE_KEYS.indexOf(styleKey(style.name))
  return rank === -1 ? PINNED_STYLE_KEYS.length : rank
}

/** Builder order: Pepperoni, Hawaiana, then every other style A-Z. Returns a new array. */
export function sortBuilderStyles(styles: PizzaStyle[]): PizzaStyle[] {
  return [...styles].sort((a, b) => pinRank(a) - pinRank(b) || byName(a, b))
}

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

/** Switches the portion style, keeping chosen ingredients up to the new style limit; a style without chiles drops them. */
export function setPortionStyle(portion: PizzaPortion, style: PizzaStyle): PizzaPortion {
  const ingredientIds = portion.ingredientIds.slice(0, style.includedIngredients)
  const { chiles, ...rest } = portion
  return { ...rest, styleId: style.id, ingredientIds, ...(chiles && hasChileVariants(style) ? { chiles } : {}) }
}

/** Back to the 3 chiles. */
export function clearChiles(portion: PizzaPortion): PizzaPortion {
  const { chiles: _chiles, ...rest } = portion
  return rest
}

/**
 * Adds or removes a chile, kept in Morrón, Serrano, Jalapeño order.
 * Removing the last one, or picking the third, goes back to the 3 chiles.
 */
export function toggleChile(portion: PizzaPortion, chile: ChileVariant): PizzaPortion {
  const current = portion.chiles ?? []
  const next = current.includes(chile) ? current.filter((code) => code !== chile) : sortChiles([...current, chile])
  if (next.length === 0 || next.length >= 3) return clearChiles(portion)
  return { ...portion, chiles: next }
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

/** How a chosen ingredient is made: once, twice (the double is a charged extra) or not at all. */
export type IngredientLevel = 'none' | 'normal' | 'doble'

export function ingredientLevel(portion: PizzaPortion, ingredientId: string): IngredientLevel {
  const extras = extraCount(portion, ingredientId)
  if (portion.ingredientIds.includes(ingredientId)) return extras > 0 ? 'doble' : 'normal'
  if (extras === 0) return 'none'
  return extras > 1 ? 'doble' : 'normal'
}

/** True when the ingredient is charged as an extra: either a double or one beyond the style's included ones. */
export function isChargedIngredient(portion: PizzaPortion, ingredientId: string): boolean {
  return extraCount(portion, ingredientId) > 0
}

/**
 * Sets how an ingredient is made on a portion. A new ingredient takes an included slot while the style
 * has one free; otherwise it is a charged extra. `doble` of an included one adds one charged extra,
 * `doble` of an extra is charged twice, and `none` removes it entirely.
 */
export function setIngredientLevel(
  portion: PizzaPortion,
  ingredientId: string,
  level: IngredientLevel,
  style: PizzaStyle,
): PizzaPortion {
  const included = portion.ingredientIds.includes(ingredientId)
  const others = portion.extraIngredientIds.filter((id) => id !== ingredientId)
  const times = (count: number) => Array.from({ length: count }, () => ingredientId)

  if (level === 'none') {
    return {
      ...portion,
      ingredientIds: portion.ingredientIds.filter((id) => id !== ingredientId),
      extraIngredientIds: others,
    }
  }
  const asIncluded = included || (portion.ingredientIds.length < style.includedIngredients && extraCount(portion, ingredientId) === 0)
  if (asIncluded) {
    return {
      ...portion,
      ingredientIds: included ? portion.ingredientIds : [...portion.ingredientIds, ingredientId],
      extraIngredientIds: [...others, ...times(level === 'doble' ? 1 : 0)],
    }
  }
  return { ...portion, extraIngredientIds: [...others, ...times(level === 'doble' ? 2 : 1)] }
}
