// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asSuperuser, asUser, createProfile, createTestDb, type TestDb } from './db.ts'

const MIGRATION_FILE = '20261124120000_legacy_pizza_category.sql'
const MIGRATION = join(import.meta.dirname, '..', 'migrations', MIGRATION_FILE)

let db: TestDb

afterEach(async () => {
  await db.close()
})

async function flags() {
  const res = await db.query<{ name: string; legacy_pizza: boolean }>(
    `select name, legacy_pizza from public.categories order by name`,
  )
  return res.rows
}

describe('legacy pizza category flag migration', () => {
  beforeEach(async () => {
    db = await createTestDb({ before: MIGRATION_FILE })
    await asSuperuser(db)
  }, 60_000)

  it('flags only the existing Pizzas category, ignoring case and surrounding spaces', async () => {
    await db.exec(`
      insert into public.categories (name, sort_order) values
        (' PIZZAS ', 1), ('Rebanadas-Pizza', 2), ('Bebidas', 3)
    `)

    await db.exec(readFileSync(MIGRATION, 'utf8'))

    expect(await flags()).toEqual([
      { name: ' PIZZAS ', legacy_pizza: true },
      { name: 'Bebidas', legacy_pizza: false },
      { name: 'Rebanadas-Pizza', legacy_pizza: false },
    ])
  })

  it('can be applied twice without changing the flags', async () => {
    await db.exec(`insert into public.categories (name, sort_order) values ('pizzas', 1), ('Bebidas', 2)`)

    await db.exec(readFileSync(MIGRATION, 'utf8'))
    await db.exec(readFileSync(MIGRATION, 'utf8'))

    expect(await flags()).toEqual([
      { name: 'Bebidas', legacy_pizza: false },
      { name: 'pizzas', legacy_pizza: true },
    ])
  })

  it('keeps the flag when the legacy category is renamed', async () => {
    await db.exec(`insert into public.categories (name, sort_order) values ('Pizzas', 1)`)
    await db.exec(readFileSync(MIGRATION, 'utf8'))

    await db.exec(`update public.categories set name = 'Pizzas viejas' where name = 'Pizzas'`)

    expect(await flags()).toEqual([{ name: 'Pizzas viejas', legacy_pizza: true }])
  })
})

describe('legacy pizza category flag after all migrations', () => {
  beforeEach(async () => {
    db = await createTestDb()
    await asSuperuser(db)
  }, 60_000)

  it('sends the flag to waiter devices in the catalog', async () => {
    await db.exec(`insert into public.categories (name, sort_order) values ('Pizzas', 1), ('Botanas', 2)`)
    await db.exec(`update public.categories set legacy_pizza = true where name = 'Pizzas'`)
    const admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
    await asUser(db, admin)
    const device = await db.query<{ r: { device_secret: string } }>(
      `select public.admin_register_device($1) as r`,
      ['Tablet 1'],
    )
    await asAnon(db)

    const catalog = await db.query<{ r: { categories: { name: string; legacy_pizza: boolean }[] } }>(
      `select public.device_list_catalog($1) as r`,
      [device.rows[0]!.r.device_secret],
    )

    expect(catalog.rows[0]!.r.categories.map((c) => [c.name, c.legacy_pizza])).toEqual([
      ['Pizzas', true],
      ['Botanas', false],
    ])
  })

  it('creates new categories unflagged, even when named Pizzas', async () => {
    await db.exec(`insert into public.categories (name) values ('Pizzas'), ('Postres')`)

    expect(await flags()).toEqual([
      { name: 'Pizzas', legacy_pizza: false },
      { name: 'Postres', legacy_pizza: false },
    ])
  })
})
