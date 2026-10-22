// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyMigration, asAnon, asSuperuser, asUser, createProfile, createTestDb, type TestDb } from './db.ts'

const MIGRATION = '20261028120000_free_token_on_delivery.sql'

type Json = Record<string, any>

let db: TestDb
let cashier: string
let burgerId: string
let drinkId: string
let waiterSecret: string
let grillSecret: string
let shift: string

async function rpc(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

const burger = () => [{ type: 'product', product_id: burgerId, quantity: 1 }]
const drink = () => [{ type: 'product', product_id: drinkId, quantity: 1 }]

async function createOrder(items: Json[] = burger(), scheduledFor: string | null = null): Promise<string> {
  await asAnon(db)
  const res = await rpc('public.device_create_order($1, $2, $3, $4, $5::jsonb, $6, $7::timestamptz)', [
    waiterSecret,
    shift,
    2,
    null,
    JSON.stringify(items),
    null,
    scheduledFor,
  ])
  return res.order_id as string
}

async function addItems(orderId: string, items: Json[] = burger()) {
  await asAnon(db)
  return rpc('public.device_add_order_items($1, $2, $3, $4::jsonb)', [waiterSecret, shift, orderId, JSON.stringify(items)])
}

async function pay(orderId: string) {
  await asUser(db, cashier)
  return rpc('public.pay_order($1, $2)', [orderId, 100_000])
}

async function kitchen(): Promise<Json[]> {
  await asAnon(db)
  return (await rpc('public.device_list_kitchen_orders($1)', [grillSecret])) as unknown as Json[]
}

async function ready(): Promise<Json[]> {
  await asAnon(db)
  return (await rpc('public.device_list_ready_orders($1, $2)', [waiterSecret, shift])) as unknown as Json[]
}

async function openOrders(): Promise<Json[]> {
  await asAnon(db)
  return (await rpc('public.device_list_open_orders($1)', [waiterSecret])) as unknown as Json[]
}

async function markReady(orderId: string) {
  const ticket = (await kitchen()).find((t) => t.id === orderId)!
  await asAnon(db)
  return rpc('public.device_mark_station_ready($1, $2, $3)', [grillSecret, orderId, ticket.lines.map((l: Json) => l.id)])
}

/** Delivers the order's ready lines, or only the first `count` of them. */
async function markDelivered(orderId: string, count?: number) {
  const order = (await ready()).find((o) => o.id === orderId)!
  const ids = order.lines.map((l: Json) => l.id).slice(0, count)
  await asAnon(db)
  return rpc('public.device_mark_delivered($1, $2, $3, $4)', [waiterSecret, shift, orderId, ids])
}

async function serve(orderId: string) {
  await markReady(orderId)
  await markDelivered(orderId)
}

async function row(orderId: string) {
  await asSuperuser(db)
  const res = await db.query<{ status: string; token: number | null; served_at: string | null }>(
    `select status, token, served_at::text from public.orders where id = $1`,
    [orderId],
  )
  return res.rows[0]
}

async function setClock(iso: string) {
  await asSuperuser(db)
  await db.exec(`create or replace function public.app_now() returns timestamptz
    language sql stable as $$ select '${iso}'::timestamptz $$`)
}

async function setup() {
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

  const drinks = await db.query<{ id: string }>(
    `insert into public.categories (name, sort_order, kitchen_station) values ('Bebidas', 102, null) returning id`,
  )
  drinkId = (
    await db.query<{ id: string }>(
      `insert into public.products (category_id, name, price_cents, active, variants)
       values ($1, 'Refresco', 2000, true, '{}') returning id`,
      [drinks.rows[0].id],
    )
  ).rows[0].id

  const admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  await asUser(db, admin)
  const waiterId = (await rpc('public.admin_create_waiter($1, $2)', ['Luis', '1234'])).waiter_id
  waiterSecret = (await rpc('public.admin_register_device($1)', ['Tablet 1'])).device_secret
  grillSecret = (await rpc('public.admin_register_device($1, $2)', ['Plancha', 'kitchen_grill'])).device_secret
  await asAnon(db)
  shift = (await rpc('public.device_start_shift($1, $2, $3)', [waiterSecret, waiterId, '1234'])).token
  await asUser(db, cashier)
  await rpc('public.open_cash_session($1)', [5000])
}

beforeEach(async () => {
  db = await createTestDb()
  await setup()
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('an open order whose lines are all delivered', () => {
  it('frees its token while it stays open and unpaid', async () => {
    const id = await createOrder()
    await serve(id)

    expect(await row(id)).toEqual({ status: 'open', token: null, served_at: null })
    expect((await openOrders()).map((o) => [o.id, o.token])).toEqual([[id, null]])
    expect((await row(await createOrder())).token).toBe(1)
  })

  it('keeps its token while a line is not delivered yet', async () => {
    const id = await createOrder([...burger(), ...drink()])
    await markReady(id)
    await markDelivered(id, 1)

    expect((await row(id)).token).toBe(1)
    expect((await row(await createOrder())).token).toBe(2)
  })

  it('takes the lowest free token when items are added after delivery', async () => {
    const first = await createOrder()
    await serve(first)
    const second = await createOrder()
    expect((await row(second)).token).toBe(1)

    await addItems(first)

    expect((await row(first)).token).toBe(2)
    expect((await kitchen()).map((t) => [t.id, t.token])).toEqual([
      [second, 1],
      [first, 2],
    ])
  })

  it('can still be paid, and ends without a token', async () => {
    const id = await createOrder()
    await serve(id)
    await pay(id)

    const done = await row(id)
    expect(done.status).toBe('paid')
    expect(done.token).toBeNull()
    expect(done.served_at).not.toBeNull()
  })
})

describe('tokens that stay as before', () => {
  it('keeps the token when items are added before delivery', async () => {
    const id = await createOrder()
    await createOrder()
    await addItems(id)

    expect((await row(id)).token).toBe(1)
    expect((await kitchen()).every((t) => t.id !== id || t.token === 1)).toBe(true)
  })

  it('gives no token to a waiting scheduled order when items are added', async () => {
    await setClock('2099-06-15T12:00:00-06:00')
    const id = await createOrder(burger(), '2099-06-15T14:00:00-06:00')
    await addItems(id)

    expect((await row(id)).token).toBeNull()
    expect((await row(await createOrder())).token).toBe(1)
  })

  it('frees the token of a paid order when its last line is delivered', async () => {
    const id = await createOrder()
    await pay(id)
    await serve(id)

    const done = await row(id)
    expect(done.token).toBeNull()
    expect(done.served_at).not.toBeNull()
  })
})

describe('an order paid with lines ready but not delivered', () => {
  it('keeps its token and stays in Entrega until delivered', async () => {
    const id = await createOrder()
    await markReady(id)
    await pay(id)

    expect(await row(id)).toEqual({ status: 'paid', token: 1, served_at: null })
    expect((await ready()).map((o) => [o.id, o.token])).toEqual([[id, 1]])
    expect((await row(await createOrder())).token).toBe(2)

    await markDelivered(id)
    const done = await row(id)
    expect(done.token).toBeNull()
    expect(done.served_at).not.toBeNull()
    expect((await ready()).map((o) => o.id)).not.toContain(id)
  })

  it('keeps the token of an order with only drinks until they are delivered', async () => {
    const id = await createOrder(drink())
    await pay(id)

    expect(await row(id)).toEqual({ status: 'paid', token: 1, served_at: null })
    await markDelivered(id)
    expect((await row(id)).token).toBeNull()
  })
})

describe('migration', () => {
  it('frees the tokens of open orders already delivered and keeps the others', async () => {
    await db.close()
    db = await createTestDb({ before: MIGRATION })
    await setup()
    const delivered = await createOrder()
    await serve(delivered)
    const cooking = await createOrder()
    expect((await row(delivered)).token).toBe(1)

    await asSuperuser(db)
    await applyMigration(db, MIGRATION)

    expect((await row(delivered)).token).toBeNull()
    expect((await row(cooking)).token).toBe(2)
    expect((await row(await createOrder())).token).toBe(1)
  })

  it('leaves tokens of orders in service alone when the script runs again', async () => {
    const id = await createOrder()
    await asSuperuser(db)
    await applyMigration(db, MIGRATION)
    expect((await row(id)).token).toBe(1)
  })
})
