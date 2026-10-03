export type PizzaSizeCode = 'chica' | 'mediana' | 'grande'

export interface PizzaSize {
  code: PizzaSizeCode
  name: string
  allowedPortions: number[]
  sortOrder: number
}

export interface PizzaStyle {
  id: string
  name: string
  description: string
  /** `special` styles come with fixed ingredients; `custom` ones let the customer pick. */
  kind: 'special' | 'custom'
  includedIngredients: number
  sortOrder: number
}

export interface PizzaIngredient {
  id: string
  name: string
  sortOrder: number
}

/** Pizza catalog without prices: the server prices every pizza at quote time. */
export interface PizzaCatalog {
  sizes: PizzaSize[]
  styles: PizzaStyle[]
  ingredients: PizzaIngredient[]
}

export interface PizzaPortion {
  styleId: string
  ingredientIds: string[]
  extraIngredientIds: string[]
  extraCheese: boolean
}

export interface PizzaConfig {
  size: PizzaSizeCode
  portions: PizzaPortion[]
}

export const MAX_EXTRA_INGREDIENTS = 10

const INVALID_CONFIG = 'La configuración de la pizza es inválida.'

const PORTION_LABELS: Record<number, string> = { 1: 'Entera', 2: 'Mitades', 3: 'Tercios', 4: 'Cuartos' }
const PORTION_FRACTIONS: Record<number, string> = { 2: '½', 3: '⅓', 4: '¼' }

/** Name of a split: `Mitades`, `Tercios`, `Cuartos` (`Entera` for a single portion). */
export function portionLabel(count: number): string {
  return PORTION_LABELS[count] ?? `${count} porciones`
}

/**
 * Client-side mirror of the SQL `validate_pizza` rules, used to gate the UI.
 * Returns Spanish messages, one per failing portion at most; `[]` means valid.
 * The server stays authoritative.
 */
export function validatePizzaConfig(config: PizzaConfig, catalog: PizzaCatalog): string[] {
  const size = catalog.sizes.find((candidate) => candidate.code === config.size)
  if (!size) return ['Tamaño de pizza inválido.']
  if (config.portions.length === 0) return [INVALID_CONFIG]
  if (!size.allowedPortions.includes(config.portions.length)) {
    return [`La pizza ${size.name} no se puede dividir en ${config.portions.length} porciones.`]
  }

  const errors: string[] = []
  for (const portion of config.portions) {
    const error = validatePortion(portion, catalog)
    if (error !== null && !errors.includes(error)) errors.push(error)
  }
  return errors
}

function validatePortion(portion: PizzaPortion, catalog: PizzaCatalog): string | null {
  const style = catalog.styles.find((candidate) => candidate.id === portion.styleId)
  if (!style) return 'Uno de los estilos no existe o no está activo.'

  const chosen = portion.ingredientIds.length
  if (style.kind === 'special') {
    if (chosen > 0) return `${style.name} ya incluye sus ingredientes.`
  } else {
    if (chosen === 0) return `Elige al menos un ingrediente para ${style.name}.`
    if (chosen > style.includedIngredients) {
      return `${style.name} incluye hasta ${style.includedIngredients} ingredientes.`
    }
  }

  if (portion.extraIngredientIds.length > MAX_EXTRA_INGREDIENTS) {
    return `Máximo ${MAX_EXTRA_INGREDIENTS} ingredientes extra por porción.`
  }

  if (hasDuplicates(portion.ingredientIds) || hasDuplicates(portion.extraIngredientIds)) {
    return 'Los ingredientes de una porción no se pueden repetir.'
  }

  const known = new Set(catalog.ingredients.map((ingredient) => ingredient.id))
  if (![...portion.ingredientIds, ...portion.extraIngredientIds].every((id) => known.has(id))) {
    return 'Uno de los ingredientes no existe o no está activo.'
  }

  return null
}

function hasDuplicates(ids: string[]): boolean {
  return new Set(ids).size !== ids.length
}

/**
 * Same text as the SQL `describe_pizza`, e.g.
 * `Pizza Grande · Mitades: ½ Estilo Varas + Jalapeños | ½ Estilo Chuy's`.
 * Ingredients are listed in catalog order; unknown ids are skipped.
 */
export function describePizza(config: PizzaConfig, catalog: PizzaCatalog): string {
  const sizeName = catalog.sizes.find((size) => size.code === config.size)?.name ?? config.size
  const count = config.portions.length

  const parts = config.portions.map((portion) => {
    let text = catalog.styles.find((style) => style.id === portion.styleId)?.name ?? ''

    const included = ingredientNames(portion.ingredientIds, catalog)
    if (included.length > 0) text += ` (${included.join(', ')})`

    const extras = ingredientNames(portion.extraIngredientIds, catalog)
    if (extras.length > 0) text += ` + ${extras.join(', ')}`

    if (portion.extraCheese) text += ' + Extra queso'

    return count > 1 ? `${PORTION_FRACTIONS[count] ?? ''} ${text}` : text
  })

  if (count === 1) return `Pizza ${sizeName}: ${parts[0]}`
  return `Pizza ${sizeName} · ${portionLabel(count)}: ${parts.join(' | ')}`
}

function ingredientNames(ids: string[], catalog: PizzaCatalog): string[] {
  return catalog.ingredients
    .filter((ingredient) => ids.includes(ingredient.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((ingredient) => ingredient.name)
}
