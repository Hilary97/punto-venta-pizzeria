export type PizzaSizeCode = 'chica' | 'mediana' | 'grande'

export interface PizzaSize {
  code: PizzaSizeCode
  name: string
  allowedPortions: number[]
  sortOrder: number
  /** Doughs left today for this size; `null` means unlimited. */
  doughLeft: number | null
}

/** True when the size has a dough limit for today and none is left. */
export function isSizeSoldOut(size: PizzaSize): boolean {
  return size.doughLeft !== null && size.doughLeft <= 0
}

export interface PizzaStyle {
  id: string
  name: string
  description: string
  /** `special` styles come with fixed ingredients; `custom` ones let the customer pick. */
  kind: 'special' | 'custom'
  /** Ingredients of the customer's choice included in the price, per portion, for either kind. */
  includedIngredients: number
  sortOrder: number
}

export interface PizzaIngredient {
  id: string
  name: string
  sortOrder: number
}

/** A pizza extra such as Extra queso: it applies to the whole pizza and is charged once. */
export interface PizzaExtra {
  id: string
  name: string
  sortOrder: number
}

/** Pizza catalog without prices: the server prices every pizza at quote time. */
export interface PizzaCatalog {
  sizes: PizzaSize[]
  styles: PizzaStyle[]
  ingredients: PizzaIngredient[]
  extras: PizzaExtra[]
}

export interface PizzaPortion {
  styleId: string
  ingredientIds: string[]
  extraIngredientIds: string[]
}

export interface PizzaConfig {
  size: PizzaSizeCode
  portions: PizzaPortion[]
  /** Extras for the whole pizza, never per portion. */
  extraIds: string[]
}

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

  const extrasError = validateExtras(config.extraIds, catalog)
  if (extrasError !== null) errors.push(extrasError)
  return errors
}

function validateExtras(extraIds: string[], catalog: PizzaCatalog): string | null {
  if (hasDuplicates(extraIds)) return 'Los extras de la pizza no se pueden repetir.'
  const known = new Set(catalog.extras.map((extra) => extra.id))
  if (!extraIds.every((id) => known.has(id))) return 'Uno de los extras no existe o no está activo.'
  return null
}

function validatePortion(portion: PizzaPortion, catalog: PizzaCatalog): string | null {
  const style = catalog.styles.find((candidate) => candidate.id === portion.styleId)
  if (!style) return 'Uno de los estilos no existe o no está activo.'

  // Included ingredients are optional on a special style; a custom style needs at least one.
  const chosen = portion.ingredientIds.length
  if (style.kind === 'custom' && chosen === 0) return `Elige al menos un ingrediente para ${style.name}.`
  if (chosen > style.includedIngredients) {
    return `${style.name} incluye hasta ${style.includedIngredients} ingredientes.`
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
 * `Pizza Grande · Mitades: ½ Estilo Varas + Jalapeños | ½ Estilo Chuy's · Extras: Extra queso`.
 * A whole pizza lists its extras like its extra ingredients: `Pizza Chica: Estilo Varas + Extra queso`.
 * Ingredients and extras are listed in catalog order; unknown ids are skipped.
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

    return count > 1 ? `${PORTION_FRACTIONS[count] ?? ''} ${text}` : text
  })

  const options = byCatalogOrder(catalog.extras, config.extraIds).join(', ')
  if (count === 1) return `Pizza ${sizeName}: ${parts[0]}${options ? ` + ${options}` : ''}`
  return `Pizza ${sizeName} · ${portionLabel(count)}: ${parts.join(' | ')}${options ? ` · Extras: ${options}` : ''}`
}

function ingredientNames(ids: string[], catalog: PizzaCatalog): string[] {
  return byCatalogOrder(catalog.ingredients, ids)
}

function byCatalogOrder(rows: { id: string; name: string; sortOrder: number }[], ids: string[]): string[] {
  return rows
    .filter((row) => ids.includes(row.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((row) => row.name)
}
