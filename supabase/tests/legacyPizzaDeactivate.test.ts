// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSuperuser, createProfile, createTestDb, type TestDb } from './db.ts'

const MIGRATION_FILE = '20261125120000_deactivate_legacy_pizza_products.sql'
const MIGRATION = join(import.meta.dirname, '..', 'migrations', MIGRATION_FILE)

let db: TestDb
let owner: string

beforeEach(async () => {
  db = await createTestDb({ before: MIGRATION_FILE })
  owner = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  await asSuperuser(db)
}, 60_000)

afterEach(async () => {
  await db.close()
})

async function category(name: string, legacyPizza: boolean): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into public.categories (name, sort_order, legacy_pizza) values ($1, 1, $2) returning id`,
    [name, legacyPizza],
  )
  return res.rows[0]!.id
}

async function product(categoryId: string, name: string, active = true): Promise<void> {
  await db.query(`insert into public.products (category_id, name, price_cents, active) values ($1, $2, 10000, $3)`, [
    categoryId,
    name,
    active,
  ])
}

async function paidSale(): Promise<string> {
  const session = await db.query<{ id: string }>(
    `insert into public.cash_sessions (opened_by, opening_cents) values ($1, 0) returning id`,
    [owner],
  )
  const sale = await db.query<{ id: string }>(
    `insert into public.sales (session_id, cashier_id, total_cents, received_cents, change_cents)
     values ($1, $2, 10000, 10000, 0) returning id`,
    [session.rows[0]!.id, owner],
  )
  return sale.rows[0]!.id
}

async function orderWith(productName: string, status: 'open' | 'paid' | 'cancelled'): Promise<void> {
  const saleId = status === 'paid' ? await paidSale() : null
  const order = await db.query<{ id: string }>(
    `insert into public.orders (table_number, created_by, status, cancelled_at, paid_sale_id, paid_at)
     values (1, $1, $2, case when $2 = 'cancelled' then now() end, $3, case when $2 = 'paid' then now() end)
     returning id`,
    [owner, status, saleId],
  )
  await db.query(
    `insert into public.order_items (order_id, product_id, product_name, quantity)
     select $1, p.id, p.name, 1 from public.products p where p.name = $2`,
    [order.rows[0]!.id, productName],
  )
}

async function activeByName() {
  const res = await db.query<{ name: string; active: boolean }>(`select name, active from public.products order by name`)
  return Object.fromEntries(res.rows.map((row) => [row.name, row.active]))
}

describe('deactivate legacy pizza products migration', () => {
  it('deactivates the flagged category products and leaves other categories alone', async () => {
    const pizzas = await category('Pizzas', true)
    const drinks = await category('Bebidas', false)
    await product(pizzas, 'Estilo Varas grande')
    await product(pizzas, 'Pizza 2 ingredientes chica')
    await product(drinks, 'Refresco')

    await db.exec(readFileSync(MIGRATION, 'utf8'))

    expect(await activeByName()).toEqual({
      'Estilo Varas grande': false,
      'Pizza 2 ingredientes chica': false,
      Refresco: true,
    })
  })

  it('keeps active a legacy pizza that an open order still has to charge', async () => {
    const pizzas = await category('Pizzas', true)
    await product(pizzas, 'Estilo Varas grande')
    await product(pizzas, 'Estilo Varas chica')
    await product(pizzas, 'Hawaiana chica')
    await orderWith('Estilo Varas grande', 'open')
    await orderWith('Estilo Varas chica', 'paid')
    await orderWith('Hawaiana chica', 'cancelled')

    await db.exec(readFileSync(MIGRATION, 'utf8'))

    expect(await activeByName()).toEqual({
      'Estilo Varas grande': true,
      'Estilo Varas chica': false,
      'Hawaiana chica': false,
    })
  })

  it('can be applied twice and does not reactivate anything', async () => {
    const pizzas = await category('Pizzas', true)
    const drinks = await category('Bebidas', false)
    await product(pizzas, 'Estilo Varas grande')
    await product(drinks, 'Agua', false)

    await db.exec(readFileSync(MIGRATION, 'utf8'))
    await db.exec(readFileSync(MIGRATION, 'utf8'))

    expect(await activeByName()).toEqual({ Agua: false, 'Estilo Varas grande': false })
  })
})
