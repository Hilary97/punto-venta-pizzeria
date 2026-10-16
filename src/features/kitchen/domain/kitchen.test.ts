import { expect, it } from 'vitest'
import { DEVICE_KINDS, STATION_LABELS, deviceKindStation } from './kitchen'

it('maps kitchen device kinds to their station and waiters to none', () => {
  expect(deviceKindStation('kitchen_pizza')).toBe('pizza')
  expect(deviceKindStation('kitchen_grill')).toBe('grill')
  expect(deviceKindStation('waiter')).toBeNull()
})

it('labels both stations', () => {
  expect(STATION_LABELS).toEqual({ pizza: 'Pizzas', grill: 'Hamburguesas y botanas' })
  expect(DEVICE_KINDS).toEqual(['waiter', 'kitchen_pizza', 'kitchen_grill'])
})
