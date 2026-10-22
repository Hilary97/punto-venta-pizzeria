// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asSuperuser, asUser, createProfile, createTestDb, type TestDb } from './db.ts'

const TABLE_TAKEN = (table: number) => `La mesa ${table} ya tiene un pedido abierto.`

type Json = Record<string, any>

let db: TestDb
let admin: string
let burgerId: string
let waiterSecret: string
let shift: string

async function rpc(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

const burger = () => JSON.stringify([{ type: 'product', product_id: burgerId, quantity: 1 }])

/** Creates an order from the waiter device. */
async function deviceOrder(table: number | null, customerName: string | null = null): Promise<string> {
  await asAnon(db)
  const res = await rpc('public.device_create_order($1, $2, $3, $4, $5::jsonb)', [waiterSecret, shift, table, customerName, burger()])
  return res.order_id as string
}

/** Creates an order from the cashier/admin screen. */
async function adminOrder(table: number | null, customerName: string | null = null): Promise<string> {
  await asUser(db, admin)
  const res = await rpc('public.create_order($1, $2, $3::jsonb)', [table, customerName, burger()])
  return res.order_id as string
}

async function orderCount(): Promise<number> {
  await asSuperuser(db)
  const res = await db.query<{ n: number }>('select count(*)::int as n from public.orders')
  return res.rows[0].n
}

beforeEach(async () => {
  db = await createTestDb()
  await asSuperuser(db)
  const cat = await db.query<{ id: string }>(
    `insert into public.categories (name, sort_order, kitchen_station) values ('Hamburguesas', 101, 'grill') returning id`,
  )
  burgerId = (
    await db.query<{ id: string }>(
      `insert into public.products (category_id, name, price_cents, active, variants)
       values ($1, 'Hamburguesa Sencilla', 8000, true, '{}') returning id`,
      [cat.rows[0].id],
    )
  ).rows[0].id

  admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  await asUser(db, admin)
  const waiterId = (await rpc('public.admin_create_waiter($1, $2)', ['Luis', '1234'])).waiter_id
  waiterSecret = (await rpc('public.admin_register_device($1)', ['Tablet 1'])).device_secret
  await asAnon(db)
  shift = (await rpc('public.device_start_shift($1, $2, $3)', [waiterSecret, waiterId, '1234'])).token
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('one open order per table', () => {
  it('rejects a second device order for a table that has an open order, leaving orders unchanged', async () => {
    await deviceOrder(3)
    await expect(deviceOrder(3)).rejects.toThrow(TABLE_TAKEN(3))
    expect(await orderCount()).toBe(1)
  })

  it('rejects a waiter order for a table the cashier already opened', async () => {
    await adminOrder(5)
    await expect(deviceOrder(5)).rejects.toThrow(TABLE_TAKEN(5))
    expect(await orderCount()).toBe(1)
  })

  it('rejects a cashier order for a table that already has an open order, from a waiter or the cashier', async () => {
    await deviceOrder(3)
    await expect(adminOrder(3)).rejects.toThrow(TABLE_TAKEN(3))
    await adminOrder(5)
    await expect(adminOrder(5)).rejects.toThrow(TABLE_TAKEN(5))
    expect(await orderCount()).toBe(2)
  })

  it('still lets the cashier create orders identified only by customer name', async () => {
    await adminOrder(null, 'Ana')
    await adminOrder(null, 'Ana')
    expect(await orderCount()).toBe(2)
  })

  it('rejects the table even when the new order also has a customer name', async () => {
    await deviceOrder(3)
    await expect(deviceOrder(3, 'Ana')).rejects.toThrow(TABLE_TAKEN(3))
    expect(await orderCount()).toBe(1)
  })

  it('still allows other tables and orders identified only by customer name', async () => {
    await deviceOrder(3)
    await deviceOrder(4)
    await deviceOrder(null, 'Ana')
    await deviceOrder(null, 'Ana')
    expect(await orderCount()).toBe(4)
  })

  it('frees the table once its open order is cancelled', async () => {
    const id = await deviceOrder(3)
    await asUser(db, admin)
    await rpc('public.cancel_order($1)', [id])
    await deviceOrder(3)
    expect(await orderCount()).toBe(2)
  })

  it('still allows adding products to the open order of the table', async () => {
    const id = await deviceOrder(3)
    await asAnon(db)
    await rpc('public.device_add_order_items($1, $2, $3, $4::jsonb)', [waiterSecret, shift, id, burger()])
    await asSuperuser(db)
    const res = await db.query<{ n: number }>('select count(*)::int as n from public.order_items where order_id = $1', [id])
    expect(res.rows[0].n).toBe(2)
  })
})
