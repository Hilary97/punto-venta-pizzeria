// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSuperuser, createTestDb, type TestDb } from './db.ts'

const MIGRATION = join(import.meta.dirname, '..', 'migrations', '20261129120000_category_section_order.sql')

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
  await asSuperuser(db)
}, 60_000)

afterEach(async () => {
  await db.close()
})

const order = async () =>
  (await db.query<{ name: string }>(`select name from public.categories order by sort_order, name`)).rows.map(
    (row) => row.name,
  )

describe('category section order', () => {
  it('orders the sections as requested and keeps any other category after them', async () => {
    await db.exec(`
      insert into public.categories (name, sort_order) values
        ('Hamburguesas', 1), ('Botanas', 2), ('Bebidas', 3), ('Bebidas preparadas', 3), ('Extras', 4),
        ('Rebanadas-Pizza', 5), ('Pizzas', 6), ('Postres', 7), ('Ensaladas', 8), ('Tacos', 9)
    `)

    await db.exec(readFileSync(MIGRATION, 'utf8'))

    expect(await order()).toEqual([
      'Hamburguesas',
      'Botanas',
      'Bebidas',
      'Bebidas preparadas',
      'Rebanadas-Pizza',
      'Ensaladas',
      'Postres',
      'Extras',
      'Pizzas',
      'Tacos',
    ])
  })

  it('matches names regardless of case, spaces or hyphens', async () => {
    await db.exec(`
      insert into public.categories (name, sort_order) values
        ('EXTRAS', 1), (' bebidas-preparadas ', 2), ('rebanadas pizza', 3)
    `)

    await db.exec(readFileSync(MIGRATION, 'utf8'))

    expect(await order()).toEqual([' bebidas-preparadas ', 'rebanadas pizza', 'EXTRAS'])
  })

  it('still appends a category created afterwards at the end', async () => {
    await db.exec(`insert into public.categories (name, sort_order) values ('Extras', 1), ('Hamburguesas', 2)`)
    await db.exec(readFileSync(MIGRATION, 'utf8'))
    await db.exec(`insert into public.categories (name) values ('Tacos')`)

    expect(await order()).toEqual(['Hamburguesas', 'Extras', 'Tacos'])
  })

  it('is idempotent and keeps legacy_pizza and the kitchen stations', async () => {
    await db.exec(`insert into public.categories (name, sort_order, kitchen_station) values
      ('Bebidas', 3, null), ('Bebidas preparadas', 3, 'drinks'), ('Pizzas', 1, 'pizza'), ('Hamburguesas', 9, 'grill')`)
    await db.exec(`update public.categories set legacy_pizza = true where name = 'Pizzas'`)
    await db.exec(readFileSync(MIGRATION, 'utf8'))
    await db.exec(readFileSync(MIGRATION, 'utf8'))

    const rows = (
      await db.query<{ name: string; sort_order: number; legacy_pizza: boolean; kitchen_station: string | null }>(
        `select name, sort_order, legacy_pizza, kitchen_station from public.categories order by sort_order`,
      )
    ).rows
    expect(rows).toEqual([
      { name: 'Hamburguesas', sort_order: 1, legacy_pizza: false, kitchen_station: 'grill' },
      { name: 'Bebidas', sort_order: 2, legacy_pizza: false, kitchen_station: null },
      { name: 'Bebidas preparadas', sort_order: 3, legacy_pizza: false, kitchen_station: 'drinks' },
      { name: 'Pizzas', sort_order: 4, legacy_pizza: true, kitchen_station: 'pizza' },
    ])
  })
})
