/**
 * Money is always represented as an integer number of cents to avoid
 * floating-point rounding errors. These helpers convert between the
 * cents representation used everywhere in the domain/database and the
 * decimal strings a human types or reads (MXN pesos).
 */

const CURRENCY_FORMATTER = new Intl.NumberFormat('es-MX', {
  style: 'decimal',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Formats an integer amount of cents as a MXN currency string, e.g. `$150.50`. */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const absoluteCents = Math.abs(cents)
  const pesos = absoluteCents / 100
  return `${sign}$${CURRENCY_FORMATTER.format(pesos)}`
}

/**
 * Parses a user-typed money string (e.g. "150.50", "1,850.00", "$150") into
 * an integer number of cents. The comma is treated exclusively as a
 * thousands separator (grouping digits in 3s) and the period as the decimal
 * separator; a comma is never interpreted as a decimal separator. Returns
 * `null` when the input cannot be parsed as a non-negative amount or when
 * the thousands grouping is malformed (e.g. "1,85", "18,50", "1,8500").
 */
export function parseMoneyInput(input: string): number | null {
  const cleaned = input.trim().replace(/\$/g, '')
  if (cleaned === '') return null

  if (!/^(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/.test(cleaned)) return null

  const pesos = Number.parseFloat(cleaned.replace(/,/g, ''))
  if (Number.isNaN(pesos) || pesos < 0) return null

  return Math.round(pesos * 100)
}
