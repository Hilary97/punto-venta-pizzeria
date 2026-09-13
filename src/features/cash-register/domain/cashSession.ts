export interface CashSession {
  id: string
  openedBy: string
  openedAt: string
  openingCents: number
  closedBy: string | null
  closedAt: string | null
  countedCents: number | null
  expectedCents: number | null
  differenceCents: number | null
}
