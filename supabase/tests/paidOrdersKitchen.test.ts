// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyMigration, asAnon, asSuperuser, asUser, createProfile, createTestDb, type TestDb } from './db.ts'

const MIGRATION = '20261026120000_paid_orders_kitchen.sql'
const CLOSED_ERROR = 'El pedido ya no está abierto.'

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

async function createOrder(scheduledFor: string | null = null, items: Json[] = burger()): Promise<string> {
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

async function markDelivered(orderId: string) {
  const order = (await ready()).find((o) => o.id === orderId)!
  await asAnon(db)
  return rpc('public.device_mark_delivered($1, $2, $3, $4)', [waiterSecret, shift, orderId, order.lines.map((l: Json) => l.id)])
}

async function row(orderId: string) {
  await asSuperuser(db)
  const res = await db.query<{ status: string; token: number | null; served_at: string | null }>(
    `select status, token, served_at::text from public.orders where id = $1`,
    [orderId],
  )
  return res.rows[0]
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

describe('an order paid before it is finished', () => {
  it('stays in the kitchen, moves to delivery when ready and ends when delivered', async () => {
    const id = await createOrder()
    await pay(id)

    expect(await row(id)).toEqual({ status: 'paid', token: 1, served_at: null })
    expect((await kitchen()).map((t) => [t.id, t.token])).toEqual([[id, 1]])
    expect(await openOrders()).toEqual([])

    await markReady(id)
    expect(await kitchen()).toEqual([])
    expect((await ready()).map((o) => [o.id, o.token])).toEqual([[id, 1]])

    await markDelivered(id)
    expect(await ready()).toEqual([])
    const done = await row(id)
    expect(done.status).toBe('paid')
    expect(done.served_at).not.toBeNull()
  })

  it('keeps its token until delivered, then frees it', async () => {
    const paid = await createOrder()
    await pay(paid)
    const second = await createOrder()
    expect((await row(second)).token).toBe(2)

    await markReady(paid)
    await markDelivered(paid)
    const third = await createOrder()
    expect((await row(third)).token).toBe(1)
  })

  it('enters the kitchen at its time when it was a scheduled order paid while waiting', async () => {
    await asSuperuser(db)
    await db.exec(`create or replace function public.app_now() returns timestamptz
      language sql stable as $$ select '2099-06-15T12:00:00-06:00'::timestamptz $$`)
    const id = await createOrder('2099-06-15T14:00:00-06:00')
    await pay(id)
    expect(await kitchen()).toEqual([])
    expect((await row(id)).token).toBeNull()

    await asSuperuser(db)
    await db.exec(`create or replace function public.app_now() returns timestamptz
      language sql stable as $$ select '2099-06-15T13:40:00-06:00'::timestamptz $$`)
    expect((await kitchen()).map((t) => [t.id, t.token, t.scheduled_for !== null])).toEqual([[id, 1, true]])
  })

  it('still rejects paying twice, adding items and cancelling, leaving the order unchanged', async () => {
    const id = await createOrder()
    await pay(id)
    await expect(pay(id)).rejects.toThrow(CLOSED_ERROR)
    await asAnon(db)
    await expect(
      rpc('public.device_add_order_items($1, $2, $3, $4::jsonb)', [waiterSecret, shift, id, JSON.stringify(burger())]),
    ).rejects.toThrow()
    await asAnon(db)
    await expect(rpc('public.device_cancel_order($1, $2, $3)', [waiterSecret, shift, id])).rejects.toThrow()
    expect(await row(id)).toEqual({ status: 'paid', token: 1, served_at: null })
    await asSuperuser(db)
    expect((await db.query(`select 1 from public.sales`)).rows).toHaveLength(1)
  })
})

describe('an order paid after it was delivered', () => {
  it('ends at payment and frees its token, as before', async () => {
    const id = await createOrder()
    await markReady(id)
    await markDelivered(id)
    await pay(id)

    const done = await row(id)
    expect(done.status).toBe('paid')
    expect(done.served_at).not.toBeNull()
    expect(await kitchen()).toEqual([])
    expect(await ready()).toEqual([])
    expect((await row(await createOrder())).token).toBe(1)
  })
})

describe('an order paid with nothing left to cook', () => {
  it('ends at payment when its cooked lines are ready but not delivered, as before', async () => {
    const id = await createOrder()
    await markReady(id)
    await pay(id)

    expect((await row(id)).served_at).not.toBeNull()
    expect(await ready()).toEqual([])
    expect((await row(await createOrder())).token).toBe(1)
  })

  it('ends at payment when it has only drinks, which never go to the kitchen', async () => {
    const id = await createOrder(null, [{ type: 'product', product_id: drinkId, quantity: 2 }])
    await pay(id)

    expect((await row(id)).served_at).not.toBeNull()
    expect(await kitchen()).toEqual([])
    expect(await ready()).toEqual([])
    expect((await row(await createOrder())).token).toBe(1)
  })

  it('keeps drinks of a prepaid order in Entrega with its food until delivered', async () => {
    const id = await createOrder(null, [...burger(), { type: 'product', product_id: drinkId, quantity: 1 }])
    await pay(id)
    expect(await ready()).toEqual([])
    await markReady(id)
    expect((await ready()).find((o) => o.id === id)!.lines).toHaveLength(2)
    await markDelivered(id)
    expect((await row(id)).served_at).not.toBeNull()
  })
})

describe('migration', () => {
  it('ends orders paid before it, so undelivered ones never reappear', async () => {
    await db.close()
    db = await createTestDb({ before: MIGRATION })
    await setup()
    const id = await createOrder()
    await pay(id)
    expect(await kitchen()).toEqual([])

    await asSuperuser(db)
    await applyMigration(db, MIGRATION)
    expect(await kitchen()).toEqual([])
    expect(await ready()).toEqual([])
    expect((await row(id)).served_at).not.toBeNull()
    expect((await row(await createOrder())).token).toBe(1)
  })

  it('does not end orders in service when the script runs again', async () => {
    const id = await createOrder()
    await pay(id)
    await asSuperuser(db)
    await applyMigration(db, MIGRATION)
    expect(await row(id)).toEqual({ status: 'paid', token: 1, served_at: null })
    expect((await kitchen()).map((t) => t.id)).toEqual([id])
  })
})
