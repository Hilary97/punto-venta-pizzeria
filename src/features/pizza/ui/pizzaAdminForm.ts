import { formatMoney } from '../../../shared/money'

/** Cents as the text a money input starts with, e.g. 13000 → "130.00". */
export function centsToInput(cents: number | undefined): string {
  return cents === undefined ? '' : formatMoney(cents).replace('$', '')
}

/** Parses an order field: blank is 0, anything but digits is -1 so the schema rejects it. */
export function parseOrderInput(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  return /^\d+$/.test(trimmed) ? Number(trimmed) : -1
}

/** The order a new row gets: right after the last one. */
export function nextSortOrder(rows: { sortOrder: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 1
}

export const CHECKBOX_CLASS = 'h-4 w-4 rounded border-slate-300 text-red-700 focus:ring-red-500'
export const SELECT_CLASS =
  'rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900 focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-200'
