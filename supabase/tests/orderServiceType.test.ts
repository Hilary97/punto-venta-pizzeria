// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyMigration, asAnon, asSuperuser, asUser, createProfile, createTestDb, type TestDb } from './db.ts'

const MIGRATION = '20261029120000_order_service_type.sql'
const INVALID_ERROR = 'El tipo de pedido no es válido.'

type Json = Record<string, any>

let db: TestDb
let cashier: string
let burgerId: string
let waiterSecret: string
let grillSecret: string
let shift: string

async function rpc(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

const burger = () => [{ type: 'product', product_id: burgerId, quantity: 1 }]

async function createOrder(
  service: string | null = 'dine_in',
  items: Json[] = burger(),
  scheduledFor: string | null = null,
): Promise<string> {
  await asAnon(db)
  const res = await rpc('public.device_create_order($1, $2, $3, $4, $5::jsonb, $6, $7::timestamptz, $8)', [
    waiterSecret,
    shift,
    2,
    null,
    JSON.stringify(items),
    null,
    scheduledFor,
    service,
  ])
  return res.order_id as string
}

/** The call of app versions without the service type. */
async function createLegacyOrder(): Promise<string> {
  await asAnon(db)
  const res = await rpc('public.device_create_order($1, $2, $3, $4, $5::jsonb, $6)', [
    waiterSecret,
    shift,
    2,
    null,
    JSON.stringify(burger()),
    null,
  ])
  return res.order_id as string
}

async function orderCount(): Promise<number> {
  await asSuperuser(db)
  return (await db.query(`select 1 from public.orders`)).rows.length
}

async function service(orderId: string): Promise<string | null> {
  await asSuperuser(db)
  const res = await db.query<{ service: string | null }>(`select service from public.orders where id = $1`, [orderId])
  return res.rows[0].service
}

async function addItems(orderId: string, items: Json[] = burger()) {
  await asAnon(db)
  return rpc('public.device_add_order_items($1, $2, $3, $4::jsonb)', [waiterSecret, shift, orderId, JSON.stringify(items)])
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

describe('creating an order with a service type', () => {
  it('stores it from a waiter device and shows it in Cocina, Entrega and open orders', async () => {
    const id = await createOrder('takeaway')

    expect(await service(id)).toBe('takeaway')
    expect((await kitchen()).map((t) => [t.id, t.service])).toEqual([[id, 'takeaway']])
    expect((await openOrders()).map((o) => [o.id, o.service])).toEqual([[id, 'takeaway']])
    await markReady(id)
    expect((await ready()).map((o) => [o.id, o.service])).toEqual([[id, 'takeaway']])
  })

  it('stores it from the register', async () => {
    await asUser(db, cashier)
    const res = await rpc('public.create_order($1, $2, $3::jsonb, $4, $5::timestamptz, $6)', [
      3,
      null,
      JSON.stringify(burger()),
      null,
      null,
      'dine_in',
    ])
    expect(await service(res.order_id)).toBe('dine_in')
  })

  it('keeps it when items are added later', async () => {
    const id = await createOrder('takeaway')
    await addItems(id)
    expect(await service(id)).toBe('takeaway')
    expect((await kitchen()).every((t) => t.service === 'takeaway')).toBe(true)
  })

  it('shows it on a waiting scheduled ticket', async () => {
    await setClock('2099-06-15T12:00:00-06:00')
    const id = await createOrder('takeaway', burger(), '2099-06-15T14:00:00-06:00')
    expect((await kitchen()).map((t) => [t.id, t.waiting, t.service])).toEqual([[id, true, 'takeaway']])
  })

  it('rejects an unknown service type and creates nothing', async () => {
    await expect(createOrder('delivery')).rejects.toThrow(INVALID_ERROR)
    expect(await orderCount()).toBe(0)
  })
})

describe('orders without a service type', () => {
  it('are still created by app versions that do not send it', async () => {
    const id = await createLegacyOrder()
    expect(await service(id)).toBeNull()
    expect((await kitchen()).map((t) => [t.id, t.service])).toEqual([[id, null]])
  })

  it('are the orders created before the migration', async () => {
    await db.close()
    db = await createTestDb({ before: MIGRATION })
    await setup()
    const id = await createLegacyOrder()

    await asSuperuser(db)
    await applyMigration(db, MIGRATION)

    expect(await service(id)).toBeNull()
    expect((await openOrders()).map((o) => [o.id, o.service])).toEqual([[id, null]])
  })
})
