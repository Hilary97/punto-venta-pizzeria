export interface PizzaDoughSize {
  sizeCode: string
  name: string
  /** `null` when no row exists for today (the size is unlimited). */
  prepared: number | null
  used: number | null
  left: number | null
}

export interface PizzaDoughDay {
  /** Business day as `YYYY-MM-DD`, exactly as the server computed it. */
  businessDay: string
  sizes: PizzaDoughSize[]
}

/** `2026-10-20` -> `20/10/2026`, by splitting the string so no timezone can shift the day. */
export function formatBusinessDay(businessDay: string): string {
  const [year, month, day] = businessDay.split('-')
  return `${day}/${month}/${year}`
}
