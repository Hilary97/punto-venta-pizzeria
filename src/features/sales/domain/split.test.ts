import { describe, expect, it } from 'vitest'
import { splitCents } from './split'

describe('splitCents', () => {
  it('splits an even total into equal shares', () => {
    expect(splitCents(30000, 3)).toEqual([10000, 10000, 10000])
  })

  it('gives the leftover cents to the first people so shares add up to the total', () => {
    expect(splitCents(10000, 3)).toEqual([3334, 3333, 3333])
  })

  it('returns the whole total for one person', () => {
    expect(splitCents(15050, 1)).toEqual([15050])
  })

  it('returns no shares for an invalid number of people', () => {
    expect(splitCents(10000, 0)).toEqual([])
    expect(splitCents(10000, 2.5)).toEqual([])
  })
})
