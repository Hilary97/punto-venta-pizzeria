// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyMigration, asAnon, asSuperuser, asUser, createProfile, createTestDb, type TestDb } from './db.ts'

const MIGRATION = '20261025120000_scheduled_orders.sql'
const TIME_ERROR = 'La hora del pedido debe ser más tarde hoy.'

type Json = Record<string, any>

let db: TestDb
let admin: string
let cashier: string
let burgerId: string
let waiterSecret: string
let grillSecret: string
let shift: string

async function rpc(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

/** Local Mexico City time on a fixed day far in the future, so the fake clock is always after the real one. */
const at = (hhmm: string) => `2099-06-15T${hhmm}:00-06:00`

/** Replaces the server clock used by the scheduled order rules. */
async function setClock(hhmm: string) {
  await asSuperuser(db)
  await db.exec(`create or replace function public.app_now() returns timestamptz
    language sql stable as $$ select '${at(hhmm)}'::timestamptz $$`)
}

const burger = (quantity = 1) => [{ type: 'product', product_id: burgerId, quantity }]

async function createOrder(scheduledFor: string | null, items: Json[] = burger(), table = 2): Promise<string> {
  await asAnon(db)
  const res = await rpc('public.device_create_order($1, $2, $3, $4, $5::jsonb, $6, $7::timestamptz)', [
    waiterSecret,
    shift,
    table,
    null,
    JSON.stringify(items),
    null,
    scheduledFor,
  ])
  return res.order_id as string
}

async function addItems(orderId: string, items: Json[]) {
  await asAnon(db)
  await rpc('public.device_add_order_items($1, $2, $3, $4::jsonb)', [waiterSecret, shift, orderId, JSON.stringify(items)])
}

async function kitchen(): Promise<Json[]> {
  await asAnon(db)
  return (await rpc('public.device_list_kitchen_orders($1)', [grillSecret])) as unknown as Json[]
}

async function openOrders(): Promise<Json[]> {
  await asAnon(db)
  return (await rpc('public.device_list_open_orders($1)', [waiterSecret])) as unknown as Json[]
}

async function row(orderId: string) {
  await asSuperuser(db)
  const res = await db.query<{ token: number | null; queued_at: string | null; scheduled_for: string | null; status: string }>(
    `select token, queued_at::text, scheduled_for::text, status from public.orders where id = $1`,
    [orderId],
  )
  return res.rows[0]
}

async function signals(): Promise<number> {
  await asSuperuser(db)
  return (await db.query<{ n: number }>(`select count(*)::int as n from realtime.sent`)).rows[0].n
}

const ms = (iso: string) => Date.parse(iso)

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
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  await asUser(db, admin)
  const waiterId = (await rpc('public.admin_create_waiter($1, $2)', ['Luis', '1234'])).waiter_id
  waiterSecret = (await rpc('public.admin_register_device($1)', ['Tablet 1'])).device_secret
  grillSecret = (await rpc('public.admin_register_device($1, $2)', ['Plancha', 'kitchen_grill'])).device_secret
  await asAnon(db)
  shift = (await rpc('public.device_start_shift($1, $2, $3)', [waiterSecret, waiterId, '1234'])).token
  await setClock('12:00')
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('creating a scheduled order', () => {
  it('keeps it out of the kitchen and without a token until it is due', async () => {
    const id = await createOrder(at('14:00'))

    const r = await row(id)
    expect(r.token).toBeNull()
    expect(r.queued_at).toBeNull()
    expect(ms(r.scheduled_for!)).toBe(ms(at('14:00')))
    expect((await kitchen()).map((t) => [t.id, t.waiting, t.token])).toEqual([[id, true, null]])

    const [open] = await openOrders()
    expect(open.id).toBe(id)
    expect(open.token).toBeNull()
    expect(open.queued_at).toBeNull()
    expect(ms(open.scheduled_for)).toBe(ms(at('14:00')))
  })

  it('queues it at creation when the time is already inside the lead window', async () => {
    const id = await createOrder(at('12:10'))

    const r = await row(id)
    expect(r.token).toBe(1)
    expect(ms(r.queued_at!)).toBe(ms(at('12:00')))
    const tickets = await kitchen()
    expect(tickets.map((t) => t.id)).toEqual([id])
    expect(ms(tickets[0].created_at)).toBe(ms(at('12:00')))
    expect(ms(tickets[0].scheduled_for)).toBe(ms(at('12:10')))
  })

  it('rejects a past time, the current minute and another day, leaving no order', async () => {
    for (const when of [at('11:59'), at('12:00'), '2099-06-16T13:00:00-06:00', '2099-06-14T13:00:00-06:00']) {
      await expect(createOrder(when)).rejects.toThrow(TIME_ERROR)
    }
    await setClock('23:30')
    await expect(createOrder('2099-06-16T00:15:00-06:00')).rejects.toThrow(TIME_ERROR)
    await asSuperuser(db)
    expect((await db.query(`select 1 from public.orders`)).rows).toEqual([])
  })

  it('accepts a time from the signed-in register too', async () => {
    await asUser(db, cashier)
    const res = await rpc('public.create_order($1, $2, $3::jsonb, $4, $5::timestamptz)', [
      3,
      null,
      JSON.stringify(burger()),
      null,
      at('15:00'),
    ])
    const r = await row(res.order_id)
    expect([r.token, r.queued_at]).toEqual([null, null])
    await asUser(db, cashier)
    await expect(
      rpc('public.create_order($1, $2, $3::jsonb, $4, $5::timestamptz)', [3, null, JSON.stringify(burger()), null, at('09:00')]),
    ).rejects.toThrow(TIME_ERROR)
  })

  it('leaves orders without a time unchanged: token and queue at creation', async () => {
    await asAnon(db)
    const res = await rpc('public.device_create_order($1, $2, $3, $4, $5::jsonb)', [
      waiterSecret,
      shift,
      1,
      null,
      JSON.stringify(burger()),
    ])
    const r = await row(res.order_id)
    expect(r.token).toBe(1)
    expect(r.scheduled_for).toBeNull()
    expect(r.queued_at).not.toBeNull()
    expect((await kitchen()).map((t) => t.id)).toEqual([res.order_id])
  })
})

describe('entering the kitchen queue', () => {
  it('enters 20 minutes before its time as a ticket timed at queue entry', async () => {
    const id = await createOrder(at('14:00'))

    await setClock('13:39')
    expect((await kitchen()).map((t) => [t.id, t.waiting, t.token])).toEqual([[id, true, null]])
    expect((await row(id)).token).toBeNull()

    await setClock('13:40')
    const tickets = await kitchen()
    expect(tickets.map((t) => t.id)).toEqual([id])
    expect(ms(tickets[0].created_at)).toBe(ms(at('13:40')))
    expect(tickets[0].token).toBe(1)
    expect(tickets[0].lines.map((l: Json) => l.quantity)).toEqual([1])
    expect(ms((await row(id)).queued_at!)).toBe(ms(at('13:40')))
  })

  it('takes the lowest free token when it enters, not when it was created', async () => {
    const a = await createOrder(null)
    const s = await createOrder(at('14:00'))
    const b = await createOrder(null)
    expect([(await row(a)).token, (await row(s)).token, (await row(b)).token]).toEqual([1, null, 2])

    await asAnon(db)
    await rpc('public.device_cancel_order($1, $2, $3)', [waiterSecret, shift, a])
    await setClock('13:45')
    await openOrders()
    expect((await row(s)).token).toBe(1)
  })

  it('enters without a token when all 50 are held', async () => {
    const s = await createOrder(at('14:00'))
    for (let i = 0; i < 50; i += 1) await createOrder(null)
    await setClock('13:45')
    expect((await kitchen()).some((t) => t.id === s)).toBe(true)
    const r = await row(s)
    expect(r.token).toBeNull()
    expect(r.queued_at).not.toBeNull()
  })

  it('is released by the waiter open orders list as well', async () => {
    await createOrder(at('14:00'))
    await setClock('13:50')
    const [open] = await openOrders()
    expect(open.token).toBe(1)
    expect(ms(open.queued_at)).toBe(ms(at('13:50')))
  })

  it('sends the realtime signal when it enters and writes nothing on later lists', async () => {
    await createOrder(at('14:00'))
    const before = await signals()
    await kitchen()
    expect(await signals()).toBe(before)

    await setClock('13:40')
    await kitchen()
    const afterRelease = await signals()
    expect(afterRelease).toBe(before + 1)
    await kitchen()
    await openOrders()
    expect(await signals()).toBe(afterRelease)
  })

  it('joins lines added while waiting into the first ticket; later lines are a new ticket', async () => {
    const id = await createOrder(at('14:00'))
    await setClock('12:30')
    await addItems(id, burger(2))
    await setClock('13:40')
    const first = await kitchen()
    expect(first).toHaveLength(1)
    expect(first[0].lines.map((l: Json) => l.quantity).sort()).toEqual([1, 2])

    await setClock('13:45')
    await addItems(id, [{ type: 'product', product_id: burgerId, quantity: 1, notes: 'sin cebolla' }])
    // Lines take the real clock; give this one its arrival time on the fake clock.
    await asSuperuser(db)
    await db.query(`update public.order_items set created_at = $1 where order_id = $2 and notes = 'sin cebolla'`, [at('13:45'), id])
    const tickets = await kitchen()
    expect(tickets).toHaveLength(2)
    expect(ms(tickets[0].created_at)).toBe(ms(at('13:40')))
  })

  it('lists orders that enter together by pickup time', async () => {
    const late = await createOrder(at('14:30'))
    const early = await createOrder(at('14:00'))
    const middle = await createOrder(at('14:10'))
    await setClock('14:15')
    expect((await kitchen()).map((t) => t.id)).toEqual([early, middle, late])
  })

  it('never enters once cancelled', async () => {
    const id = await createOrder(at('14:00'))
    await asAnon(db)
    await rpc('public.device_cancel_order($1, $2, $3)', [waiterSecret, shift, id])
    await setClock('13:50')
    expect(await kitchen()).toEqual([])
    const r = await row(id)
    expect([r.status, r.token, r.queued_at]).toEqual(['cancelled', null, null])
  })
})

describe('lead time setting', () => {
  it('defaults to 20 minutes and is readable by signed-in staff', async () => {
    await asUser(db, cashier)
    expect(await rpc('public.get_order_settings()')).toEqual({ scheduled_lead_minutes: 20 })
  })

  it('lets the admin change it, applying to orders still waiting', async () => {
    const id = await createOrder(at('14:00'))
    await asUser(db, admin)
    expect(await rpc('public.admin_set_scheduled_lead_minutes($1)', [45])).toEqual({ scheduled_lead_minutes: 45 })

    await setClock('13:14')
    expect((await kitchen()).map((t) => [t.id, t.waiting, t.token])).toEqual([[id, true, null]])
    await setClock('13:15')
    expect((await kitchen()).map((t) => t.id)).toEqual([id])
  })

  it('rejects non-admins and invalid values, keeping the setting', async () => {
    await asUser(db, cashier)
    await expect(rpc('public.admin_set_scheduled_lead_minutes($1)', [30])).rejects.toThrow(
      'Solo un administrador puede cambiar la anticipación de los pedidos programados.',
    )
    await asUser(db, admin)
    for (const bad of [null, -1, 241]) {
      await expect(rpc('public.admin_set_scheduled_lead_minutes($1)', [bad])).rejects.toThrow(
        'La anticipación debe estar entre 0 y 240 minutos.',
      )
    }
    expect(await rpc('public.get_order_settings()')).toEqual({ scheduled_lead_minutes: 20 })
    await asAnon(db)
    await expect(rpc('public.get_order_settings()')).rejects.toThrow()
  })
})

describe('migration', () => {
  it('queues existing orders at their creation time', async () => {
    await db.close()
    db = await createTestDb({ before: MIGRATION })
    await asSuperuser(db)
    const user = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
    await db.query(
      `insert into public.orders (table_number, created_by, created_at) values (1, $1, '2026-10-20T10:00:00Z'), (2, $1, now())`,
      [user],
    )
    await applyMigration(db, MIGRATION)
    await asSuperuser(db)
    const res = await db.query<{ same: boolean; scheduled_for: string | null }>(
      `select queued_at = created_at as same, scheduled_for from public.orders`,
    )
    expect(res.rows).toEqual([
      { same: true, scheduled_for: null },
      { same: true, scheduled_for: null },
    ])
  })
})
