// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asSuperuser, asUser, createProfile, createTestDb, type TestDb } from './db.ts'

const WAITING_ERROR = 'El pedido programado todavía no entra a la cola.'

type Json = Record<string, any>

let db: TestDb
let cashier: string
let burgerId: string
let sliceId: string
let drinkId: string
let waiterSecret: string
let grillSecret: string
let pizzaSecret: string
let shift: string

async function rpc(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

/** Local Mexico City time on a fixed day far in the future, so the fake clock is always after the real one. */
const at = (hhmm: string) => `2099-06-15T${hhmm}:00-06:00`

async function setClock(hhmm: string) {
  await asSuperuser(db)
  await db.exec(`create or replace function public.app_now() returns timestamptz
    language sql stable as $$ select '${at(hhmm)}'::timestamptz $$`)
}

const line = (productId: string, quantity = 1) => ({ type: 'product', product_id: productId, quantity })

async function createOrder(scheduledFor: string | null, items: Json[] = [line(burgerId)], table = 2): Promise<string> {
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

async function kitchen(secret = grillSecret): Promise<Json[]> {
  await asAnon(db)
  return (await rpc('public.device_list_kitchen_orders($1)', [secret])) as unknown as Json[]
}

async function markReady(orderId: string, lineIds: string[], secret = grillSecret) {
  await asAnon(db)
  return rpc('public.device_mark_station_ready($1, $2, $3)', [secret, orderId, lineIds])
}

async function row(orderId: string) {
  await asSuperuser(db)
  const res = await db.query<{ token: number | null; queued_at: string | null }>(
    `select token, queued_at::text from public.orders where id = $1`,
    [orderId],
  )
  return res.rows[0]
}

async function readyLines(orderId: string): Promise<number> {
  await asSuperuser(db)
  const res = await db.query<{ n: number }>(
    `select count(*)::int as n from public.order_items where order_id = $1 and ready_at is not null`,
    [orderId],
  )
  return res.rows[0].n
}

const ms = (iso: string) => Date.parse(iso)

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
  sliceId = await product('Rebanadas', 'pizza', 102, 'Rebanada Pepperoni')
  drinkId = await product('Bebidas', null, 103, 'Refresco')

  const admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  await asUser(db, admin)
  const waiterId = (await rpc('public.admin_create_waiter($1, $2)', ['Luis', '1234'])).waiter_id
  waiterSecret = (await rpc('public.admin_register_device($1)', ['Tablet 1'])).device_secret
  grillSecret = (await rpc('public.admin_register_device($1, $2)', ['Plancha', 'kitchen_grill'])).device_secret
  pizzaSecret = (await rpc('public.admin_register_device($1, $2)', ['Horno', 'kitchen_pizza'])).device_secret
  await asAnon(db)
  shift = (await rpc('public.device_start_shift($1, $2, $3)', [waiterSecret, waiterId, '1234'])).token
  await setClock('12:00')
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('a scheduled order waiting to enter the queue', () => {
  it('shows in each station after the queue, waiting, without token, with only that station lines', async () => {
    const queued = await createOrder(null)
    const scheduled = await createOrder(at('14:00'), [line(burgerId, 2), line(sliceId), line(drinkId)], 5)

    const grill = await kitchen()
    expect(grill.map((t) => [t.id, t.waiting, t.token])).toEqual([
      [queued, false, 1],
      [scheduled, true, null],
    ])
    expect(ms(grill[1].scheduled_for)).toBe(ms(at('14:00')))
    expect(grill[1].table_number).toBe(5)
    expect(grill[1].lines.map((l: Json) => [l.product_name, l.quantity])).toEqual([['Hamburguesa Sencilla', 2]])

    const pizza = await kitchen(pizzaSecret)
    expect(pizza.map((t) => [t.id, t.waiting, t.token])).toEqual([[scheduled, true, null]])
    expect(pizza[0].lines.map((l: Json) => l.product_name)).toEqual(['Rebanada Pepperoni'])

    // Listing never releases it nor gives it a token.
    expect(await row(scheduled)).toEqual({ token: null, queued_at: null })
  })

  it('lists waiting orders by pickup time', async () => {
    const late = await createOrder(at('15:00'))
    const early = await createOrder(at('14:00'))
    const middle = await createOrder(at('14:30'))
    expect((await kitchen()).map((t) => t.id)).toEqual([early, middle, late])
  })

  it('does not show in a station it has no lines for', async () => {
    await createOrder(at('14:00'), [line(burgerId), line(drinkId)])
    expect(await kitchen(pizzaSecret)).toEqual([])
  })

  it('shows when paid while waiting, and not once cancelled', async () => {
    const paid = await createOrder(at('14:00'))
    const cancelled = await createOrder(at('14:10'))
    await asUser(db, cashier)
    await rpc('public.open_cash_session($1)', [5000])
    await rpc('public.pay_order($1, $2)', [paid, 100_000])
    await asAnon(db)
    await rpc('public.device_cancel_order($1, $2, $3)', [waiterSecret, shift, cancelled])

    expect((await kitchen()).map((t) => [t.id, t.waiting])).toEqual([[paid, true]])
  })

  it('cannot be marked ready, leaving its lines pending', async () => {
    const id = await createOrder(at('14:00'))
    const [ticket] = await kitchen()

    await expect(markReady(id, ticket.lines.map((l: Json) => l.id))).rejects.toThrow(WAITING_ERROR)
    expect(await readyLines(id)).toBe(0)
    expect((await kitchen()).map((t) => [t.id, t.waiting])).toEqual([[id, true]])
  })

  it('joins the queue with token and turn when it is due, then can be marked ready', async () => {
    const first = await createOrder(null)
    const id = await createOrder(at('14:00'))
    await setClock('13:40')

    const tickets = await kitchen()
    expect(tickets.map((t) => [t.id, t.waiting, t.token])).toEqual([
      [first, false, 1],
      [id, false, 2],
    ])
    expect(ms(tickets[1].created_at)).toBe(ms(at('13:40')))

    await markReady(id, tickets[1].lines.map((l: Json) => l.id))
    expect(await readyLines(id)).toBe(1)
    expect((await kitchen()).map((t) => t.id)).toEqual([first])
  })

  it('still marks ordinary orders ready as before', async () => {
    const id = await createOrder(null)
    const [ticket] = await kitchen()
    expect(ticket.waiting).toBe(false)
    await markReady(id, ticket.lines.map((l: Json) => l.id))
    expect(await kitchen()).toEqual([])
  })
})
