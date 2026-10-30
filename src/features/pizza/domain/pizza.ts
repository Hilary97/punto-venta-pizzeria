import { byName } from '../../../shared/sortByName'

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

  if (hasDuplicates(portion.ingredientIds)) return 'Los ingredientes de una porción no se pueden repetir.'

  // An extra ingredient may be doubled, never more.
  if (portion.extraIngredientIds.some((id) => portion.extraIngredientIds.filter((other) => other === id).length > 2)) {
    return 'Un ingrediente extra se puede pedir hasta 2 veces por porción.'
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
 * Ingredients and extras are listed alphabetically; unknown ids are skipped.
 * A doubled extra ingredient is listed once as `Extra <name>`: `Pizza Chica: Estilo Varas + Extra Jalapeños`.
 * A doubled included ingredient (also one of the extras) reads `Extra <name>` inside the included list.
 */
export function describePizza(config: PizzaConfig, catalog: PizzaCatalog): string {
  const sizeName = catalog.sizes.find((size) => size.code === config.size)?.name ?? config.size
  const count = config.portions.length

  const parts = config.portions.map((portion) => {
    let text = catalog.styles.find((style) => style.id === portion.styleId)?.name ?? ''

    // An included ingredient that is also an extra is doubled: it takes one of the extras.
    const included = catalog.ingredients
      .filter((row) => portion.ingredientIds.includes(row.id))
      .sort(byName)
      .map((row) => (portion.extraIngredientIds.includes(row.id) ? `Extra ${row.name}` : row.name))
    if (included.length > 0) text += ` (${included.join(', ')})`

    const remaining = [...portion.extraIngredientIds]
    for (const id of portion.ingredientIds) {
      const at = remaining.indexOf(id)
      if (at !== -1) remaining.splice(at, 1)
    }
    const extras = extraIngredientNames(remaining, catalog)
    if (extras.length > 0) text += ` + ${extras.join(', ')}`

    return count > 1 ? `${PORTION_FRACTIONS[count] ?? ''} ${text}` : text
  })

  const options = byNameOrder(catalog.extras, config.extraIds).join(', ')
  if (count === 1) return `Pizza ${sizeName}: ${parts[0]}${options ? ` + ${options}` : ''}`
  return `Pizza ${sizeName} · ${portionLabel(count)}: ${parts.join(' | ')}${options ? ` · Extras: ${options}` : ''}`
}

/** Each extra ingredient once, alphabetically; a doubled one reads `Extra <name>`. */
function extraIngredientNames(ids: string[], catalog: PizzaCatalog): string[] {
  return catalog.ingredients
    .filter((row) => ids.includes(row.id))
    .sort(byName)
    .map((row) => (ids.filter((id) => id === row.id).length > 1 ? `Extra ${row.name}` : row.name))
}

function byNameOrder(rows: { id: string; name: string; sortOrder: number }[], ids: string[]): string[] {
  return rows
    .filter((row) => ids.includes(row.id))
    .sort(byName)
    .map((row) => row.name)
}

/** How a card shows a line label: its title plus, for built pizzas, one group per style or portion with its ingredients. */
export interface PizzaLabelLayout {
  title: string
  groups: { name: string; items: string[] }[]
}

/**
 * Lays out a `describePizza` label so cards show one ingredient per row instead of `|`, `+` and `()`-joined text.
 * `Pizza Grande · Mitades: ½ A (X, Y) + Z | ½ B · Extras: E` becomes title `Pizza Grande · Mitades` with groups
 * `½ A` [X, Y, Z], `½ B` [] and `Extras` [E]; `Pizza Chica: A (X) + Z + E` becomes `Pizza Chica` with `A` [X, Z, E].
 * Any other label (not a built pizza) is just its title.
 */
export function pizzaLabelLayout(label: string): PizzaLabelLayout {
  const header = label.indexOf(': ')
  if (header === -1 || !label.startsWith('Pizza ')) return { title: label, groups: [] }
  const portions = label.slice(header + 2).split(' | ')
  const groups = []
  const last = portions.pop() ?? ''
  const extras = last.indexOf(' · Extras: ')
  for (const portion of extras === -1 ? [...portions, last] : [...portions, last.slice(0, extras)]) {
    groups.push(portionGroup(portion))
  }
  if (extras !== -1) groups.push({ name: 'Extras', items: last.slice(extras + 11).split(', ') })
  return { title: label.slice(0, header), groups }
}

/** `½ A (X, Y) + Z, W` → `½ A` with [X, Y, Z, W]. */
function portionGroup(text: string): { name: string; items: string[] } {
  const [style = '', ...added] = text.split(' + ')
  const items = added.flatMap((names) => names.split(', '))
  const open = style.lastIndexOf(' (')
  if (open === -1 || !style.endsWith(')')) return { name: style, items }
  return { name: style.slice(0, open), items: [...style.slice(open + 2, -1).split(', '), ...items] }
}
