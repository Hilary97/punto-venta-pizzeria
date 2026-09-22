import type { SaleWithItems } from '../../sales/domain/sale'
import type { ReturnRecord } from '../../returns/domain/returnRecord'

export interface ProductSoldSummary {
  productId: string | null
  productName: string
  quantitySold: number
  quantityReturned: number
  subtotalCents: number
}

/** Groups all sold line items across the given sales by product, summing quantities and subtotals. */
export function summarizeProductsSold(sales: SaleWithItems[]): ProductSoldSummary[] {
  const summaries = new Map<string, ProductSoldSummary>()

  for (const sale of sales) {
    for (const item of sale.items) {
      const key = item.productId ?? `name:${item.productName}`
      const existing = summaries.get(key)
      const subtotalCents = item.unitPriceCents * item.quantity

      if (existing) {
        existing.quantitySold += item.quantity
        existing.quantityReturned += item.returnedQuantity
        existing.subtotalCents += subtotalCents
      } else {
        summaries.set(key, {
          productId: item.productId,
          productName: item.productName,
          quantitySold: item.quantity,
          quantityReturned: item.returnedQuantity,
          subtotalCents,
        })
      }
    }
  }

  return Array.from(summaries.values())
}

export interface ReturnItemView {
  saleItemId: string
  productName: string
  quantity: number
  amountCents: number
}

export interface ReturnView {
  returnId: string
  createdAt: string
  reason: string | null
  totalCents: number
  items: ReturnItemView[]
}

/** Enriches return items (which only carry a saleItemId) with the product name from the fetched sales. */
export function attachProductNamesToReturnItems(returns: ReturnRecord[], sales: SaleWithItems[]): ReturnView[] {
  const productNameBySaleItemId = new Map<string, string>()
  for (const sale of sales) {
    for (const item of sale.items) {
      productNameBySaleItemId.set(item.id, item.productName)
    }
  }

  return returns.map((returnRecord) => ({
    returnId: returnRecord.id,
    createdAt: returnRecord.createdAt,
    reason: returnRecord.reason,
    totalCents: returnRecord.totalCents,
    items: returnRecord.items.map((item) => ({
      saleItemId: item.saleItemId,
      productName: productNameBySaleItemId.get(item.saleItemId) ?? 'Producto desconocido',
      quantity: item.quantity,
      amountCents: item.amountCents,
    })),
  }))
}
