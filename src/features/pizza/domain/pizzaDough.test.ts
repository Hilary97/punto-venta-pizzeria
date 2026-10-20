import { describe, expect, it } from 'vitest'
import { formatBusinessDay } from './pizzaDough'

describe('formatBusinessDay', () => {
  it('formats the date string as day/month/year', () => {
    expect(formatBusinessDay('2026-10-20')).toBe('20/10/2026')
    expect(formatBusinessDay('2027-01-01')).toBe('01/01/2027')
  })
})
