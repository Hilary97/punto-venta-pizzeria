import { describe, expect, it } from 'vitest'
import type { Order } from './order'
import { filterOrders, sortOrdersByName } from './orderFilter'

function order(id: string, tableNumber: number | null, customerName: string | null): Order {
  return { id, tableNumber, customerName, status: 'open', createdAt: '2026-01-01T00:00:00Z', items: [], waiterName: null, notes: null }
}

const orders = [order('a', 3, 'José'), order('b', 5, null), order('c', null, 'Juan'), order('d', 3, 'Ana')]
const ids = (list: Order[]) => list.map((o) => o.id)
const none = { tableNumber: null, nameQuery: '' }

describe('filterOrders', () => {
  it('returns every order, in order, without filters', () => {
    expect(ids(filterOrders(orders, none))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('filters by table and excludes orders without table', () => {
    expect(ids(filterOrders(orders, { ...none, tableNumber: 3 }))).toEqual(['a', 'd'])
  })

  it('ignores a blank name query', () => {
    expect(ids(filterOrders(orders, { ...none, nameQuery: '   ' }))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('matches names case-insensitively', () => {
    expect(ids(filterOrders(orders, { ...none, nameQuery: 'JU' }))).toEqual(['c'])
  })

  it('matches names accent-insensitively in both directions', () => {
    expect(ids(filterOrders(orders, { ...none, nameQuery: 'jose' }))).toEqual(['a'])
    expect(ids(filterOrders([order('x', null, 'Jose')], { ...none, nameQuery: 'JOSÉ' }))).toEqual(['x'])
  })

  it('matches substrings and trims the query', () => {
    expect(ids(filterOrders(orders, { ...none, nameQuery: '  na ' }))).toEqual(['d'])
  })

  it('excludes orders without name when the query is not empty', () => {
    expect(ids(filterOrders(orders, { ...none, nameQuery: 'a' }))).not.toContain('b')
  })

  it('combines table and name filters', () => {
    expect(ids(filterOrders(orders, { tableNumber: 3, nameQuery: 'ana' }))).toEqual(['d'])
    expect(ids(filterOrders(orders, { tableNumber: 5, nameQuery: 'ana' }))).toEqual([])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterOrders(orders, { ...none, nameQuery: 'zzz' })).toEqual([])
  })
})

describe('sortOrdersByName', () => {
  it('sorts named orders A-Z and leaves table-only orders last, by table number', () => {
    const list = [
      order('t5', 5, null),
      order('jose', 3, 'José'),
      order('t2', 2, null),
      order('ana', null, 'ana'),
      order('none', null, null),
      order('beto', 1, 'Beto'),
    ]
    expect(ids(sortOrdersByName(list))).toEqual(['ana', 'beto', 'jose', 't2', 't5', 'none'])
  })

  it('keeps the oldest first among orders with the same name and does not mutate the input', () => {
    const late = { ...order('late', 4, 'Ana'), createdAt: '2026-01-01T02:00:00Z' }
    const early = { ...order('early', 4, 'Ana'), createdAt: '2026-01-01T01:00:00Z' }
    const list = [late, early]
    expect(ids(sortOrdersByName(list))).toEqual(['early', 'late'])
    expect(ids(list)).toEqual(['late', 'early'])
  })
})
