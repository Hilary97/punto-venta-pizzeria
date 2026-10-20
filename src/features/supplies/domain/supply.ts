import { z } from 'zod'

export const SUPPLY_UNITS = ['kg', 'g', 'l', 'ml', 'pz'] as const

export type SupplyUnit = (typeof SUPPLY_UNITS)[number]

export const SUPPLY_UNIT_LABELS: Record<SupplyUnit, string> = {
  kg: 'kg',
  g: 'g',
  l: 'L',
  ml: 'ml',
  pz: 'pz',
}

export interface Supply {
  id: string
  name: string
  unit: SupplyUnit
  stock: number
  /** At or below this amount the supply goes on the "Para comprar" list. */
  stockMin: number
  active: boolean
}

export interface SupplyPurchase {
  id: string
  supplyId: string
  supplyName: string
  unit: SupplyUnit
  quantity: number
  costCents: number
  createdByName: string | null
  createdAt: string
}

export type SupplyStatus = 'ok' | 'buy'

export function supplyStatus(supply: Pick<Supply, 'stock' | 'stockMin'>): SupplyStatus {
  return supply.stock <= supply.stockMin ? 'buy' : 'ok'
}

const STOCK_MIN_ERROR = 'El mínimo debe ser 0 o más, con hasta 3 decimales.'

function hasAtMostThreeDecimals(value: number): boolean {
  const scaled = value * 1000
  return Math.abs(scaled - Math.round(scaled)) < 1e-6
}

export const supplyFormSchema = z.object({
  name: z.string().trim().min(1, { error: 'El nombre es obligatorio.' }).max(80, { error: 'Máximo 80 caracteres.' }),
  unit: z.enum(SUPPLY_UNITS, { error: 'Elige una unidad.' }),
  stockMin: z
    .number({ error: STOCK_MIN_ERROR })
    .min(0, { error: STOCK_MIN_ERROR })
    .refine(hasAtMostThreeDecimals, { error: STOCK_MIN_ERROR }),
  active: z.boolean(),
})

export type SupplyFormValues = z.infer<typeof supplyFormSchema>

/**
 * Parses a typed quantity ("10", "2.5", "0.250", "2,5") into a number.
 * Returns `null` when empty, negative, not a number or with more than 3 decimals.
 */
export function parseQuantityInput(text: string): number | null {
  const cleaned = text.trim()
  if (!/^\d+([.,]\d{1,3})?$/.test(cleaned)) return null
  return Number.parseFloat(cleaned.replace(',', '.'))
}

function startOfLocalDay(date: string, addDays = 0): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day! + addDays)
}

/**
 * Turns local `YYYY-MM-DD` dates into the half-open ISO range
 * `[start of from-day, start of the day after to-day)` the RPC expects.
 */
export function purchaseRange(from: string, to: string): { from: string; to: string } {
  return { from: startOfLocalDay(from).toISOString(), to: startOfLocalDay(to, 1).toISOString() }
}

function formatLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** First and last day of the month of `now`, as local `YYYY-MM-DD` strings. */
export function currentMonthRange(now: Date): { from: string; to: string } {
  return {
    from: formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: formatLocalDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  }
}
