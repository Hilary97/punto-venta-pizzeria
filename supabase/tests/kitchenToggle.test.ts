// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asSuperuser, asUser, createProfile, createTestDb, type TestDb } from './db.ts'

const ADMIN_ONLY = 'Solo un administrador puede activar o desactivar la cocina.'

type Json = Record<string, any>

let db: TestDb
let admin: string
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

const line = (productId: string, quantity = 1) => ({ type: 'product', product_id: productId, quantity })

let customerSeq = 0
const nextCustomer = () => `Cliente ${++customerSeq}`

async function createOrder(items: Json[] = [line(burgerId), line(drinkId)], scheduledFor: string | null = null): Promise<string> {
  await asAnon(db)
  const res = await rpc('public.device_create_order($1, $2, $3, $4, $5::jsonb, $6, $7::timestamptz)', [
    waiterSecret,
    shift,
    null,
    nextCustomer(),
    JSON.stringify(items),
    null,
    scheduledFor,
  ])
  return res.order_id as string
}

async function addItems(orderId: string, items: Json[]) {
  await asAnon(db)
  return rpc('public.device_add_order_items($1, $2, $3, $4::jsonb)', [waiterSecret, shift, orderId, JSON.stringify(items)])
}

async function pay(orderId: string) {
  await asUser(db, cashier)
  return rpc('public.pay_order($1, $2)', [orderId, 100_000])
}

async function setEnabled(userId: string, enabled: boolean) {
  await asUser(db, userId)
  return rpc('public.set_kitchen_enabled($1)', [enabled])
}

async function isEnabled(userId: string): Promise<boolean> {
  await asUser(db, userId)
  const res = await db.query<{ r: boolean }>('select public.kitchen_enabled() as r')
  return res.rows[0].r
}

async function kitchen(): Promise<Json[]> {
  await asAnon(db)
  return (await rpc('public.device_list_kitchen_orders($1)', [grillSecret])) as unknown as Json[]
}

async function ready(): Promise<Json[]> {
  await asAnon(db)
  return (await rpc('public.device_list_ready_orders($1, $2)', [waiterSecret, shift])) as unknown as Json[]
}

async function markReady(orderId: string) {
  await asSuperuser(db)
  const ids = (
    await db.query<{ id: string }>(`select id from public.order_items where order_id = $1 and station = 'grill'`, [orderId])
  ).rows.map((r) => r.id)
  await asAnon(db)
  return rpc('public.device_mark_station_ready($1, $2, $3)', [grillSecret, orderId, ids])
}

async function order(orderId: string) {
  await asSuperuser(db)
  const res = await db.query<{ status: string; token: number | null; served: boolean }>(
    `select status, token, served_at is not null as served from public.orders where id = $1`,
    [orderId],
  )
  return res.rows[0]
}

/** Lines still waiting for the kitchen or for delivery. */
async function pendingLines(orderId: string): Promise<number> {
  await asSuperuser(db)
  const res = await db.query<{ n: number }>(
    `select count(*)::int as n from public.order_items
     where order_id = $1 and (ready_at is null or delivered_at is null)`,
    [orderId],
  )
  return res.rows[0].n
}

async function lineCount(orderId: string): Promise<number> {
  await asSuperuser(db)
  const res = await db.query<{ n: number }>(`select count(*)::int as n from public.order_items where order_id = $1`, [orderId])
  return res.rows[0].n
}

beforeEach(async () => {
  db = await createTestDb()
  await asSuperuser(db)
  const product = async (category: string, station: string | null, sort: number, name: string) => {
    const cat = await db.query<{ id: string }>(
      `insert into public.categories (name, sort_order, kitchen_station) values ($1, $2, $3) returning id`,
      [category, sort, station],
    )
    return (
      await db.query<{ id: string }>(
        `insert into public.products (category_id, name, price_cents, active, variants)
         values ($1, $2, 8000, true, '{}') returning id`,
        [cat.rows[0].id, name],
      )
    ).rows[0].id
  }
  burgerId = await product('Hamburguesas', 'grill', 101, 'Hamburguesa Sencilla')
  drinkId = await product('Bebidas', null, 102, 'Refresco')

  admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  await asUser(db, admin)
  const waiterId = (await rpc('public.admin_create_waiter($1, $2)', ['Luis', '1234'])).waiter_id
  waiterSecret = (await rpc('public.admin_register_device($1)', ['Tablet 1'])).device_secret
  grillSecret = (await rpc('public.admin_register_device($1, $2)', ['Plancha', 'kitchen_grill'])).device_secret
  await asAnon(db)
  shift = (await rpc('public.device_start_shift($1, $2, $3)', [waiterSecret, waiterId, '1234'])).token
  await asUser(db, cashier)
  await rpc('public.open_cash_session($1)', [5000])
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('kitchen switch', () => {
  it('starts on and is readable by admin and cashier', async () => {
    expect(await isEnabled(admin)).toBe(true)
    expect(await isEnabled(cashier)).toBe(true)
  })

  it('only an admin can change it; a rejected call leaves it unchanged', async () => {
    await expect(setEnabled(cashier, false)).rejects.toThrow(ADMIN_ONLY)
    expect(await isEnabled(admin)).toBe(true)

    await asAnon(db)
    await expect(rpc('public.set_kitchen_enabled($1)', [false])).rejects.toThrow()
    expect(await isEnabled(admin)).toBe(true)

    await setEnabled(admin, false)
    expect(await isEnabled(cashier)).toBe(false)
    await setEnabled(admin, true)
    expect(await isEnabled(cashier)).toBe(true)
  })

  it('rejects a null value and leaves the setting unchanged', async () => {
    await expect(setEnabled(admin, null as unknown as boolean)).rejects.toThrow()
    expect(await isEnabled(admin)).toBe(true)
  })
})

describe('with the kitchen off', () => {
  beforeEach(async () => {
    await setEnabled(admin, false)
  })

  it('new orders skip Cocina and Entrega and free their token', async () => {
    const id = await createOrder()

    expect(await kitchen()).toEqual([])
    expect(await ready()).toEqual([])
    expect(await pendingLines(id)).toBe(0)
    expect(await order(id)).toEqual({ status: 'open', token: null, served: false })
  })

  it('added items skip the kitchen too', async () => {
    const id = await createOrder([line(drinkId)])
    await addItems(id, [line(burgerId, 2)])

    expect(await kitchen()).toEqual([])
    expect(await ready()).toEqual([])
    expect(await pendingLines(id)).toBe(0)
    expect(await lineCount(id)).toBe(2)
  })

  it('a scheduled order never takes a token when its time comes', async () => {
    await asSuperuser(db)
    const scheduledFor = (await db.query<{ t: string }>(`select (public.app_now() + interval '6 hours')::text as t`)).rows[0].t
    const id = await createOrder([line(burgerId)], scheduledFor)
    await asSuperuser(db)
    await db.exec(`create or replace function public.app_now() returns timestamptz
      language sql stable as $$ select now() + interval '6 hours' $$`)

    expect(await kitchen()).toEqual([])
    expect(await order(id)).toEqual({ status: 'open', token: null, served: false })
  })

  it('paying ends the order', async () => {
    const id = await createOrder()
    const sale = await pay(id)

    expect(sale.total_cents).toBe(16_000)
    expect(await order(id)).toEqual({ status: 'paid', token: null, served: true })
  })
})

describe('switching the kitchen off', () => {
  it('finishes every pending line of orders in service and frees their tokens', async () => {
    const cooking = await createOrder()
    const inDelivery = await createOrder()
    await markReady(inDelivery)
    const paidCooking = await createOrder()
    await pay(paidCooking)
    expect((await kitchen()).map((t) => t.id)).toEqual([cooking, paidCooking])
    // Each order has a drink, ready at once, so all three show in Entrega.
    expect((await ready()).length).toBe(3)
    expect(await order(paidCooking)).toEqual({ status: 'paid', token: 3, served: false })

    await setEnabled(admin, false)

    expect(await kitchen()).toEqual([])
    expect(await ready()).toEqual([])
    for (const id of [cooking, inDelivery, paidCooking]) expect(await pendingLines(id)).toBe(0)
    expect(await order(cooking)).toEqual({ status: 'open', token: null, served: false })
    expect(await order(inDelivery)).toEqual({ status: 'open', token: null, served: false })
    expect(await order(paidCooking)).toEqual({ status: 'paid', token: null, served: true })
  })

  it('a rejected switch-off leaves pending orders untouched', async () => {
    const id = await createOrder()
    await expect(setEnabled(cashier, false)).rejects.toThrow(ADMIN_ONLY)

    expect((await kitchen()).map((t) => t.id)).toEqual([id])
    expect(await order(id)).toEqual({ status: 'open', token: 1, served: false })
  })
})

describe('switching the kitchen back on', () => {
  it('sends new orders to the kitchen again', async () => {
    await setEnabled(admin, false)
    const skipped = await createOrder()
    await setEnabled(admin, true)
    const cooked = await createOrder()

    expect((await kitchen()).map((t) => t.id)).toEqual([cooked])
    expect(await order(cooked)).toEqual({ status: 'open', token: 1, served: false })
    expect(await pendingLines(skipped)).toBe(0)
  })
})
