import { describe, expect, it } from 'vitest'
import { byName, compareNames } from './sortByName'

describe('compareNames', () => {
  it('sorts Spanish names alphabetically, ignoring case and accents', () => {
    const names = ['jamón', 'Ñora', 'Aceitunas', 'nopal', 'Ácido', 'Champiñones', 'piña']
    expect([...names].sort(compareNames)).toEqual(['Aceitunas', 'Ácido', 'Champiñones', 'jamón', 'nopal', 'Ñora', 'piña'])
  })

  it('compares numbers by value', () => {
    expect(['Mesa 10', 'Mesa 2'].sort(compareNames)).toEqual(['Mesa 2', 'Mesa 10'])
  })
})

describe('byName', () => {
  it('sorts rows by name and ignores their manual sort order', () => {
    const rows = [
      { name: 'Salami', sortOrder: 1 },
      { name: 'Champiñones', sortOrder: 3 },
      { name: 'Jamón', sortOrder: 2 },
    ]
    expect([...rows].sort(byName).map((row) => row.name)).toEqual(['Champiñones', 'Jamón', 'Salami'])
  })
})
