/// <reference types="node" />
process.env.TZ = 'America/Mexico_City'

import { describe, expect, it } from 'vitest'
import { currentMonthRange, purchaseRange } from './supply'

describe('supplies date helpers in America/Mexico_City', () => {
  it('runs in the Mexico City timezone', () => {
    expect(new Date(2026, 9, 1).toISOString()).toBe('2026-10-01T06:00:00.000Z')
  })

  it('turns the October 2026 range into fixed UTC instants', () => {
    expect(purchaseRange('2026-10-01', '2026-10-31')).toEqual({
      from: '2026-10-01T06:00:00.000Z',
      to: '2026-11-01T06:00:00.000Z',
    })
  })

  it('keeps 23:30 on the last local day inside October', () => {
    expect(currentMonthRange(new Date(2026, 9, 31, 23, 30))).toEqual({ from: '2026-10-01', to: '2026-10-31' })
  })
})
