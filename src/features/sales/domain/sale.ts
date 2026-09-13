export interface SaleItemPayload {
  productId: string
  quantity: number
}

export interface SaleSummary {
  id: string
  createdAt: string
  totalCents: number
  receivedCents: number
  changeCents: number
}

export interface SaleItemRecord {
  id: string
  productId: string | null
  productName: string
  unitPriceCents: number
  quantity: number
  returnedQuantity: number
}

export interface SaleWithItems extends SaleSummary {
  items: SaleItemRecord[]
}
