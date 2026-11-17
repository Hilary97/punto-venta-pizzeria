import type { PizzaCatalog, PizzaConfig } from '../../pizza/domain/pizza'
import { describePizza } from '../../pizza/domain/pizza'

export interface VoiceContext {
  products: { id: string; name: string; variants: string[] }[]
  pizzaCatalog: PizzaCatalog
}

export type VoiceLine =
  | { kind: 'product'; quantity: number; notes: string; heard: string; productId: string; name: string; variant: string | null }
  | { kind: 'pizza'; quantity: number; notes: string; heard: string; pizza: PizzaConfig; name: string }
  | { kind: 'pickProduct'; quantity: number; notes: string; heard: string; options: { productId: string; name: string }[] }
  | { kind: 'missingVariant'; quantity: number; notes: string; heard: string; productId: string; name: string; options: string[] }
  | { kind: 'unknown'; heard: string; reason: string }

/** Longest proposed note, as S9 asks. */
const MAX_NOTE_LENGTH = 200

/** Lowercases and strips accents so `Búfalo` and `bufalo` compare equal. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
}

/** Words that never end up in a note: filler and spoken quantities. */
const FILLER_WORDS = new Set([...Object.keys(NUMBER_WORDS), 'de', 'del', 'con', 'en', 'para', 'la', 'el', 'los', 'las', 'unos', 'unas', 'y', 'mas', 'por', 'favor', 'porfa', 'dame', 'me', 'das', 'quiero', 'son', 'es'])

/** Words of a split pizza; the interpreter never guesses them (S7). */
const DIVISION_WORDS = new Set(['mitad', 'mitades', 'tercio', 'tercios', 'cuarto', 'cuartos', 'porcion', 'porciones'])

const NO_PIZZA_BUILDER = 'No interpreto mitades, ingredientes ni extras: usa "Armar pizza" para esta pizza.'
const NO_STYLE = 'Falta el estilo: dime también el estilo de la pizza, p. ej. "grande de pepperoni".'

const SEGMENT_SPLIT = /[,;\n]|\s+(?:y|m[aá]s)\s+/gi

interface Token {
  raw: string
  /** Folded, plural-stripped comparison key. */
  key: string
  used: boolean
}

/** Splits on anything that is not a letter or a digit: ` - `, accents stay inside a word. */
function tokenize(text: string): Token[] {
  return text
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
    .map((word) => ({ raw: word, key: norm(fold(word)), used: false }))
}

/** `cocas` and `coca` compare equal; shorter words keep their trailing `s` (`res`). */
function norm(token: string): string {
  return token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token
}

function same(a: string, b: string): boolean {
  return a === b || norm(a) === norm(b)
}

/** Words of a folded name: `Coca-Cola 600 ml` -> [coca, cola, 600, ml]. */
function nameWords(name: string): string[] {
  return fold(name)
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '')
    .map(norm)
}

/**
 * The indexes of tokens that spell `targets` in order (gaps allowed), or `null`
 * when the targets are missing. Empty targets never match.
 */
function findTargets(tokens: Token[], targets: string[]): number[] | null {
  if (targets.length === 0) return null
  const hits: number[] = []
  let k = 0
  for (let i = 0; i < tokens.length; i++) {
    if (k < targets.length && same(tokens[i]!.key, targets[k]!)) {
      hits.push(i)
      k++
    }
  }
  return k === targets.length ? hits : null
}

function readQuantity(heard: string): { quantity: number; rest: string } {
  let text = heard
  let quantity = 1
  // Trailing " xN ": `coca x4`.
  const trailing = /^(.+?)\s*[x×]\s*(\d{1,3})$/i.exec(text)
  if (trailing && trailing[1]!.trim() !== '') {
    quantity = Number(trailing[2])
    text = trailing[1]!
  }
  // Leading digits: `3 cocas`, `2x coca`, `2 x coca`.
  const digits = /^(\d{1,3})(?:\s*[x×]\s*|\s+)(.+)$/i.exec(text)
  if (digits) return { quantity: Number(digits[1]), rest: digits[2]! }
  // Number words: `dos cocas`; longest alternatives first so `una` wins over `un`.
  const words = /^(una|uno|un|doce|once|diez|nueve|ocho|siete|seis|cinco|cuatro|tres|dos)\s+(.+)$/i.exec(text)
  if (words) {
    const parsed = NUMBER_WORDS[fold(words[1]!)]
    if (parsed !== undefined) return { quantity: parsed, rest: words[2]! }
  }
  return { quantity, rest: text.trim() }
}

function leftover(tokens: Token[]): string {
  return tokens
    .filter((token) => !token.used && !FILLER_WORDS.has(token.key))
    .map((token) => token.raw)
    .join(' ')
    .slice(0, MAX_NOTE_LENGTH)
}

function productLine(product: VoiceContext['products'][number], quantity: number, heard: string, tokens: Token[], nameHits: number[]): VoiceLine {
  for (const i of nameHits) tokens[i]!.used = true
  let variant: string | null = null
  for (const option of product.variants) {
    const hits = findTargets(tokens, nameWords(option))
    if (hits !== null) {
      variant = option
      for (const i of hits) tokens[i]!.used = true
      break
    }
  }
  if (product.variants.length > 0 && variant === null) {
    return { kind: 'missingVariant', quantity, notes: leftover(tokens), heard, productId: product.id, name: product.name, options: [...product.variants] }
  }
  return { kind: 'product', quantity, notes: leftover(tokens), heard, productId: product.id, name: product.name, variant }
}

function matchFull(products: VoiceContext['products'][number][], tokens: Token[]): VoiceContext['products'][number][] {
  return products.filter((product) => findTargets(tokens, nameWords(product.name)) !== null)
}

function matchFirstToken(products: VoiceContext['products'][number][], tokens: Token[]): VoiceContext['products'][number][] {
  return products.filter((product) => {
    const first = nameWords(product.name)[0]
    return first !== undefined && tokens.some((token) => same(token.key, first))
  })
}

function pickProductLine(products: VoiceContext['products'][number][], quantity: number, heard: string, tokens: Token[]): VoiceLine {
  return {
    kind: 'pickProduct',
    quantity,
    notes: leftover(tokens),
    heard,
    options: products.map((product) => ({ productId: product.id, name: product.name })),
  }
}

/** Size keys: the folded name plus the code, so `grande` matches either way. */
function sizeKeys(size: VoiceContext['pizzaCatalog']['sizes'][number]): string[] {
  return [...new Set([...nameWords(size.name), norm(fold(size.code))])]
}

/** Style words without the optional leading `Estilo `. */
function styleWords(style: VoiceContext['pizzaCatalog']['styles'][number]): string[] {
  const words = nameWords(style.name)
  return words[0] === 'estilo' ? words.slice(1) : words
}

function pizzaLine(quantity: number, heard: string, tokens: Token[], size: VoiceContext['pizzaCatalog']['sizes'][number], sizeHits: number[], style: VoiceContext['pizzaCatalog']['styles'][number], styleHits: number[], catalog: PizzaCatalog): VoiceLine {
  for (const i of [...sizeHits, ...styleHits]) tokens[i]!.used = true
  for (const token of tokens) {
    if (token.key === 'pizza') token.used = true
  }
  const pizza: PizzaConfig = {
    size: size.code,
    portions: [{ styleId: style.id, ingredientIds: [], extraIngredientIds: [] }],
    extraIds: [],
  }
  return { kind: 'pizza', quantity, notes: leftover(tokens), heard, pizza, name: describePizza(pizza, catalog) }
}

function parseSegment(segment: string, context: VoiceContext): VoiceLine | null {
  const heard = segment.trim()
  if (heard === '') return null
  const { quantity, rest } = readQuantity(heard)
  const tokens = tokenize(rest)
  const products = context.products

  // Every word of one product name was spoken: that product, no guessing.
  const full = matchFull(products, tokens)
  if (full.length === 1) {
    const product = full[0]!
    return productLine(product, quantity, heard, tokens, findTargets(tokens, nameWords(product.name))!)
  }
  if (full.length > 1) return pickProductLine(full, quantity, heard, tokens)

  // Pizza realm (S7): a size named, or a division word, makes it a pizza request.
  const sizeMatch = context.pizzaCatalog.sizes
    .map((size) => ({ size, hits: findTargets(tokens, sizeKeys(size)) }))
    .find((match) => match.hits !== null)
  const division = tokens.some((token) => DIVISION_WORDS.has(token.key))
  if (sizeMatch) {
    // A size was named: halves/ingredients/extras go to the builder (S7), but the
    // style's own words do not count as ingredients so `grande de pepperoni` stays a pizza
    // even when `Pepperoni` is also a real ingredient, and the ingredient/extra guard
    // never runs on a segment that is not already a pizza request (S6).
    const styleMatch = context.pizzaCatalog.styles
      .map((style) => ({ style, hits: findTargets(tokens, styleWords(style)) }))
      .find((match) => match.hits !== null)
    const styleIndexes = new Set(styleMatch?.hits ?? [])
    const nonStyle = tokens.filter((_, index) => !styleIndexes.has(index))
    const ingredient = context.pizzaCatalog.ingredients.find((row) => findTargets(nonStyle, nameWords(row.name)) !== null)
    const extra = context.pizzaCatalog.extras.find((row) => findTargets(nonStyle, nameWords(row.name)) !== null)
    if (division || ingredient || extra) return { kind: 'unknown', heard, reason: NO_PIZZA_BUILDER }
    if (styleMatch) {
      return pizzaLine(quantity, heard, tokens, sizeMatch.size, sizeMatch.hits!, styleMatch.style, styleMatch.hits!, context.pizzaCatalog)
    }
    return { kind: 'unknown', heard, reason: NO_STYLE }
  }
  if (division) return { kind: 'unknown', heard, reason: NO_PIZZA_BUILDER }

  // First significant token of the name, only when it identifies one product (S6).
  const byFirst = matchFirstToken(products, tokens)
  if (byFirst.length === 1) {
    const product = byFirst[0]!
    const first = nameWords(product.name)[0]!
    const hit = tokens.findIndex((token) => same(token.key, first))
    return productLine(product, quantity, heard, tokens, [hit])
  }
  if (byFirst.length > 1) return pickProductLine(byFirst, quantity, heard, tokens)

  return { kind: 'unknown', heard, reason: `No reconocí "${heard}" en el catálogo.` }
}

/**
 * Interprets dictated text into proposed ticket lines (S3): pure, offline,
 * and nothing enters the draft here; the confirmation screen decides.
 */
export function parseSpokenOrder(text: string, context: VoiceContext): VoiceLine[] {
  // NFC first: a decomposed "ma\u0301s" (NFD pastes) must split like the precomposed one.
  return text
    .normalize('NFC')
    .split(SEGMENT_SPLIT)
    .map((segment) => parseSegment(segment, context))
    .filter((line): line is VoiceLine => line !== null)
}
