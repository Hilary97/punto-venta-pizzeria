export interface ReturnItemRecord {
  id: string
  saleItemId: string
  quantity: number
  amountCents: number
}

export interface ReturnRecord {
  id: string
  saleId: string
  cashierId: string
  reason: string | null
  totalCents: number
  createdAt: string
  items: ReturnItemRecord[]
}
