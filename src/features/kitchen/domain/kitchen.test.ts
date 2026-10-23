import { expect, it } from 'vitest'
import { DEVICE_KINDS, STATION_LABELS, delayLevel, deviceKindStation } from './kitchen'

it('maps kitchen device kinds to their station and waiters to none', () => {
  expect(deviceKindStation('kitchen_pizza')).toBe('pizza')
  expect(deviceKindStation('kitchen_grill')).toBe('grill')
  expect(deviceKindStation('kitchen_drinks')).toBe('drinks')
  expect(deviceKindStation('waiter')).toBeNull()
})

it('labels every station', () => {
  expect(STATION_LABELS).toEqual({ pizza: 'Pizzas', grill: 'Hamburguesas y botanas', drinks: 'Bebidas preparadas' })
  expect(DEVICE_KINDS).toEqual(['waiter', 'kitchen_pizza', 'kitchen_grill', 'kitchen_drinks'])
})

it('rates the delay: yellow from 15 minutes, red from 25', () => {
  const start = '2026-01-01T15:00:00Z'
  const after = (minutes: number, seconds = 0) => new Date(Date.parse(start) + (minutes * 60 + seconds) * 1000)
  expect(delayLevel(start, after(0))).toBe('ok')
  expect(delayLevel(start, after(14, 59))).toBe('ok')
  expect(delayLevel(start, after(15))).toBe('warning')
  expect(delayLevel(start, after(24, 59))).toBe('warning')
  expect(delayLevel(start, after(25))).toBe('late')
  expect(delayLevel(start, after(90))).toBe('late')
  expect(delayLevel('not a date', after(90))).toBe('ok')
})
