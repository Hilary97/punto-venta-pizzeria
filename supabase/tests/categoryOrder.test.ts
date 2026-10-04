// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSuperuser, createTestDb, type TestDb } from './db.ts'

const MIGRATION = join(import.meta.dirname, '..', 'migrations', '20261011120000_category_button_order.sql')

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
  await asSuperuser(db)
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('category button order', () => {
  it('puts Hamburguesas, Botanas, Bebidas, Extras, Rebanadas-Pizza first and keeps the rest after', async () => {
    await db.exec(`
      insert into public.categories (name, sort_order) values
        ('Pizzas', 1), ('Postres', 2), ('Rebanadas-Pizza', 3), ('Extras', 4),
        ('Ensaladas', 5), ('Bebidas', 6), ('Botanas', 7), ('Hamburguesas', 8)
    `)

    await db.exec(readFileSync(MIGRATION, 'utf8'))

    const res = await db.query<{ name: string }>(`select name from public.categories order by sort_order, name`)
    expect(res.rows.map((row) => row.name)).toEqual([
      'Hamburguesas',
      'Botanas',
      'Bebidas',
      'Extras',
      'Rebanadas-Pizza',
      'Pizzas',
      'Postres',
      'Ensaladas',
    ])
  })

  it('appends categories created without sort_order to the end', async () => {
    await db.exec(`insert into public.categories (name, sort_order) values ('Hamburguesas', 1), ('Botanas', 7)`)
    await db.exec(`insert into public.categories (name) values ('Postres')`)
    await db.exec(`insert into public.categories (name) values ('Tacos')`)

    const res = await db.query<{ name: string; sort_order: number }>(
      `select name, sort_order from public.categories order by sort_order, name`,
    )
    expect(res.rows).toEqual([
      { name: 'Hamburguesas', sort_order: 1 },
      { name: 'Botanas', sort_order: 7 },
      { name: 'Postres', sort_order: 8 },
      { name: 'Tacos', sort_order: 9 },
    ])
  })

  it('appends the first category created without sort_order at position 1', async () => {
    await db.exec(`insert into public.categories (name) values ('Postres')`)

    const res = await db.query<{ sort_order: number }>(`select sort_order from public.categories`)
    expect(res.rows).toEqual([{ sort_order: 1 }])
  })

  it('keeps an explicit sort_order', async () => {
    await db.exec(`insert into public.categories (name, sort_order) values ('Botanas', 7), ('Pizzas', 3)`)

    const res = await db.query<{ name: string; sort_order: number }>(
      `select name, sort_order from public.categories order by sort_order`,
    )
    expect(res.rows).toEqual([
      { name: 'Pizzas', sort_order: 3 },
      { name: 'Botanas', sort_order: 7 },
    ])
  })

  it('matches names regardless of case, spaces or hyphens', async () => {
    await db.exec(`
      insert into public.categories (name, sort_order) values
        ('Otros', 1), ('rebanadas pizza', 2), (' HAMBURGUESAS ', 3)
    `)

    await db.exec(readFileSync(MIGRATION, 'utf8'))

    const res = await db.query<{ name: string }>(`select name from public.categories order by sort_order, name`)
    expect(res.rows.map((row) => row.name)).toEqual([' HAMBURGUESAS ', 'rebanadas pizza', 'Otros'])
  })
})
