import { expect, it } from 'vitest'
import { DEVICE_KINDS, STATION_LABELS, deviceKindStation, pickupGroups, type KitchenLine } from './kitchen'

it('maps kitchen device kinds to their station and waiters to none', () => {
  expect(deviceKindStation('kitchen_pizza')).toBe('pizza')
  expect(deviceKindStation('kitchen_grill')).toBe('grill')
  expect(deviceKindStation('waiter')).toBeNull()
})

it('labels both stations', () => {
  expect(STATION_LABELS).toEqual({ pizza: 'Pizzas', grill: 'Hamburguesas y botanas' })
  expect(DEVICE_KINDS).toEqual(['waiter', 'kitchen_pizza', 'kitchen_grill'])
})

function line(id: string, station: KitchenLine['station']): KitchenLine {
  return { id, productName: id, quantity: 1, type: 'product', pizza: null, notes: null, variant: null, station }
}

it('groups delivery lines by pickup place: pizzas, grill, then the rest, hiding empty groups', () => {
  const groups = pickupGroups([line('soda', null), line('burger', 'grill'), line('pizza', 'pizza'), line('wings', 'grill')])
  expect(groups.map((g) => [g.label, g.lines.map((l) => l.id)])).toEqual([
    ['Recoger en Pizzas (ficha roja)', ['pizza']],
    ['Recoger en Hamburguesas y botanas (ficha azul)', ['burger', 'wings']],
    ['Bebidas y otros', ['soda']],
  ])
  expect(groups.map((g) => g.station)).toEqual(['pizza', 'grill', null])
  expect(pickupGroups([line('burger', 'grill')]).map((g) => g.label)).toEqual(['Recoger en Hamburguesas y botanas (ficha azul)'])
  expect(pickupGroups([])).toEqual([])
})
