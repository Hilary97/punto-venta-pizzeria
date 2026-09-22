import { describe, expect, it } from 'vitest'
import type { SaleWithItems } from '../../sales/domain/sale'
import type { ReturnRecord } from '../../returns/domain/returnRecord'
import { attachProductNamesToReturnItems, summarizeProductsSold } from './sessionDetailView'

function makeSale(overrides: Partial<SaleWithItems> = {}): SaleWithItems {
  return {
    id: 'sale-1',
    createdAt: '2026-09-01T12:00:00Z',
    totalCents: 0,
    receivedCents: 0,
    changeCents: 0,
    items: [],
    ...overrides,
  }
}

describe('summarizeProductsSold', () => {
  it('returns an empty list for no sales', () => {
    expect(summarizeProductsSold([])).toEqual([])
  })

  it('summarizes a single sale with a single product', () => {
    const sales = [
      makeSale({
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            productName: 'Pizza Hawaiana',
            unitPriceCents: 15000,
            quantity: 2,
            returnedQuantity: 0,
          },
        ],
      }),
    ]

    expect(summarizeProductsSold(sales)).toEqual([
      {
        productId: 'prod-1',
        productName: 'Pizza Hawaiana',
        quantitySold: 2,
        quantityReturned: 0,
        subtotalCents: 30000,
      },
    ])
  })

  it('sums quantities and subtotals across multiple sales of the same product', () => {
    const sales = [
      makeSale({
        id: 'sale-1',
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            productName: 'Pizza Hawaiana',
            unitPriceCents: 15000,
            quantity: 2,
            returnedQuantity: 1,
          },
        ],
      }),
      makeSale({
        id: 'sale-2',
        items: [
          {
            id: 'item-2',
            productId: 'prod-1',
            productName: 'Pizza Hawaiana',
            unitPriceCents: 15000,
            quantity: 3,
            returnedQuantity: 0,
          },
        ],
      }),
    ]

    expect(summarizeProductsSold(sales)).toEqual([
      {
        productId: 'prod-1',
        productName: 'Pizza Hawaiana',
        quantitySold: 5,
        quantityReturned: 1,
        subtotalCents: 75000,
      },
    ])
  })

  it('groups a sale item with a null productId by product name instead of dropping it', () => {
    const sales = [
      makeSale({
        items: [
          {
            id: 'item-1',
            productId: null,
            productName: 'Producto eliminado',
            unitPriceCents: 5000,
            quantity: 1,
            returnedQuantity: 0,
          },
          {
            id: 'item-2',
            productId: null,
            productName: 'Producto eliminado',
            unitPriceCents: 5000,
            quantity: 2,
            returnedQuantity: 0,
          },
        ],
      }),
    ]

    expect(summarizeProductsSold(sales)).toEqual([
      {
        productId: null,
        productName: 'Producto eliminado',
        quantitySold: 3,
        quantityReturned: 0,
        subtotalCents: 15000,
      },
    ])
  })
})

describe('attachProductNamesToReturnItems', () => {
  it('returns an empty list for no returns', () => {
    expect(attachProductNamesToReturnItems([], [])).toEqual([])
  })

  it('resolves the product name for each return item from the sales lookup', () => {
    const sales = [
      makeSale({
        id: 'sale-1',
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            productName: 'Pizza Hawaiana',
            unitPriceCents: 15000,
            quantity: 2,
            returnedQuantity: 1,
          },
        ],
      }),
    ]

    const returns: ReturnRecord[] = [
      {
        id: 'return-1',
        saleId: 'sale-1',
        cashierId: 'cashier-1',
        reason: 'Cliente insatisfecho',
        totalCents: 15000,
        createdAt: '2026-09-01T13:00:00Z',
        items: [{ id: 'ri-1', saleItemId: 'item-1', quantity: 1, amountCents: 15000 }],
      },
    ]

    expect(attachProductNamesToReturnItems(returns, sales)).toEqual([
      {
        returnId: 'return-1',
        createdAt: '2026-09-01T13:00:00Z',
        reason: 'Cliente insatisfecho',
        totalCents: 15000,
        items: [{ saleItemId: 'item-1', productName: 'Pizza Hawaiana', quantity: 1, amountCents: 15000 }],
      },
    ])
  })
})
