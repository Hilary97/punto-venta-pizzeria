export interface PizzaDoughSize {
  sizeCode: string
  name: string
  /** `null` when the current shift has no row for the size (it is unlimited). */
  prepared: number | null
  used: number | null
  left: number | null
}

/** The doughs of the current shift, which ends when the cash register is closed. */
export interface PizzaDoughDay {
  /** When the current shift started (the last register close), as an ISO timestamp. */
  shiftStartedAt: string
  sizes: PizzaDoughSize[]
}
