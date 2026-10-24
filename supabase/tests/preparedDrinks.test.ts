// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asSuperuser, asUser, createProfile, createTestDb, type TestDb } from './db.ts'

type Json = Record<string, any>

const MIGRATION = join(import.meta.dirname, '..', 'migrations', '20261101120000_prepared_drinks_station.sql')

async function rpc(db: TestDb, sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
  await asSuperuser(db)
}, 60_000)

afterEach(async () => {
  await db.close()
})

async function seedMenu() {
  await db.exec(`
    insert into public.categories (name, sort_order) values ('Hamburguesas', 1), ('Bebidas', 3), ('Extras', 4);
    insert into public.products (category_id, name, price_cents, active, variants)
    select c.id, p.name, 3000, true, '{}'
    from public.categories c
    join (values
      ('Bebidas', 'Malteada Moka'), ('Bebidas', 'Malteada Vainilla'), ('Bebidas', 'Café Nescafé Clásico'),
      ('Bebidas', 'Cafe Moka'), ('Bebidas', 'Refresco Coca-Cola'), ('Bebidas', 'Naranjada'),
      ('Extras', 'Malteada extra'), ('Hamburguesas', 'Hamburguesa Sencilla')
    ) as p(category, name) on p.category = c.name;
  `)
}

const categoryOf = async (product: string) =>
  (
    await db.query<{ name: string }>(
      `select c.name from public.products p join public.categories c on c.id = p.category_id where p.name = $1`,
      [product],
    )
  ).rows[0].name

describe('prepared drinks category', () => {
  it('creates "Bebidas preparadas" right after Bebidas and moves shakes and coffees into it', async () => {
    await seedMenu()

    await db.exec(readFileSync(MIGRATION, 'utf8'))

    const cats = await db.query<{ name: string; kitchen_station: string | null }>(
      `select name, kitchen_station from public.categories order by sort_order, name`,
    )
    expect(cats.rows).toEqual([
      { name: 'Hamburguesas', kitchen_station: null },
      { name: 'Bebidas', kitchen_station: null },
      { name: 'Bebidas preparadas', kitchen_station: 'drinks' },
      { name: 'Extras', kitchen_station: null },
    ])
    for (const moved of ['Malteada Moka', 'Malteada Vainilla', 'Café Nescafé Clásico', 'Cafe Moka']) {
      expect(await categoryOf(moved)).toBe('Bebidas preparadas')
    }
    expect(await categoryOf('Refresco Coca-Cola')).toBe('Bebidas')
    expect(await categoryOf('Naranjada')).toBe('Bebidas')
    expect(await categoryOf('Malteada extra')).toBe('Extras')
  })

  it('can be applied twice without duplicating the category', async () => {
    await seedMenu()

    await db.exec(readFileSync(MIGRATION, 'utf8'))
    await db.exec(readFileSync(MIGRATION, 'utf8'))

    const res = await db.query<{ n: number }>(
      `select count(*)::int as n from public.categories where name = 'Bebidas preparadas'`,
    )
    expect(res.rows[0].n).toBe(1)
    expect(await categoryOf('Malteada Moka')).toBe('Bebidas preparadas')
  })

  it('creates nothing without a Bebidas category', async () => {
    await db.exec(`insert into public.categories (name, sort_order) values ('Pizzas', 1), ('Postres', 5)`)

    await db.exec(readFileSync(MIGRATION, 'utf8'))

    const res = await db.query<{ name: string }>(`select name from public.categories order by sort_order, name`)
    expect(res.rows.map((row) => row.name)).toEqual(['Pizzas', 'Postres'])
  })

  it('keeps lines already ordered unchanged', async () => {
    await seedMenu()
    const shake = await db.query<{ id: string }>(`select id from public.products where name = 'Malteada Moka'`)
    await asUser(db, await createProfile(db, { role: 'admin', fullName: 'Admin' }))
    const orderId = (
      await rpc(db, 'public.create_order($1, $2, $3::jsonb)', [1, null, JSON.stringify([{ product_id: shake.rows[0].id, quantity: 1 }])])
    ).order_id
    await asSuperuser(db)
    const before = await db.query(`select station, ready_at from public.order_items where order_id = $1`, [orderId])
    expect(before.rows).toEqual([{ station: null, ready_at: expect.any(Date) }])

    await db.exec(readFileSync(MIGRATION, 'utf8'))

    const after = await db.query(`select station, ready_at from public.order_items where order_id = $1`, [orderId])
    expect(after.rows).toEqual(before.rows)
  })
})

describe('prepared drinks station', () => {
  let waiterSecret: string
  let drinksSecret: string
  let grillSecret: string
  let token: string
  let admin: string
  let shakeId: string
  let burgerId: string
  let sodaId: string

  beforeEach(async () => {
    const cats = await db.query<{ id: string; name: string }>(
      `insert into public.categories (name, sort_order, kitchen_station) values
         ('Hamburguesas', 101, 'grill'), ('Bebidas', 102, null), ('Bebidas preparadas', 103, 'drinks')
       returning id, name`,
    )
    const catId = (n: string) => cats.rows.find((c) => c.name === n)!.id
    const prods = await db.query<{ id: string; name: string }>(
      `insert into public.products (category_id, name, price_cents, active, variants) values
         ($1, 'Hamburguesa Sencilla', 8000, true, '{}'),
         ($2, 'Refresco', 2000, true, '{}'),
         ($3, 'Malteada Moka', 6000, true, '{}') returning id, name`,
      [catId('Hamburguesas'), catId('Bebidas'), catId('Bebidas preparadas')],
    )
    const pid = (n: string) => prods.rows.find((p) => p.name === n)!.id
    burgerId = pid('Hamburguesa Sencilla')
    sodaId = pid('Refresco')
    shakeId = pid('Malteada Moka')

    admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
    await asUser(db, admin)
    const waiterId = (await rpc(db, 'public.admin_create_waiter($1, $2)', ['Luis', '1234'])).waiter_id
    waiterSecret = (await rpc(db, 'public.admin_register_device($1)', ['Tablet 1'])).device_secret
    grillSecret = (await rpc(db, 'public.admin_register_device($1, $2)', ['Plancha', 'kitchen_grill'])).device_secret
    drinksSecret = (await rpc(db, 'public.admin_register_device($1, $2)', ['Barra', 'kitchen_drinks'])).device_secret
    await asAnon(db)
    token = (await rpc(db, 'public.device_start_shift($1, $2, $3)', [waiterSecret, waiterId, '1234'])).token
  })

  async function createOrder(items: Json[]): Promise<string> {
    await asAnon(db)
    const res = await rpc(db, 'public.device_create_order($1, $2, $3, $4, $5::jsonb)', [
      waiterSecret,
      token,
      2,
      null,
      JSON.stringify(items),
    ])
    return res.order_id as string
  }

  const kitchen = (secret: string) => rpc(db, 'public.device_list_kitchen_orders($1)', [secret])
  const ready = () => rpc(db, 'public.device_list_ready_orders($1, $2)', [waiterSecret, token])
  async function markReady(secret: string, orderId: string) {
    const order = (await kitchen(secret)).find((o: Json) => o.id === orderId)
    return rpc(db, 'public.device_mark_station_ready($1, $2, $3)', [
      secret,
      orderId,
      (order?.lines ?? []).map((l: Json) => l.id),
    ])
  }

  it('registers a prepared-drinks kitchen device', async () => {
    await asUser(db, admin)
    const devices = await rpc(db, 'public.admin_list_devices()')
    expect(devices.find((d: Json) => d.name === 'Barra').kind).toBe('kitchen_drinks')
  })

  it('still rejects an unknown device kind', async () => {
    await asUser(db, admin)
    await expect(rpc(db, 'public.admin_register_device($1, $2)', ['Bar', 'kitchen_bar'])).rejects.toThrow(
      'El tipo de dispositivo no es válido.',
    )
  })

  it('sends shakes to the drinks station and delivers them once ready, apart from the food', async () => {
    const orderId = await createOrder([
      { product_id: shakeId, quantity: 2 },
      { product_id: burgerId, quantity: 1 },
      { product_id: sodaId, quantity: 1 },
    ])

    const drinks = await kitchen(drinksSecret)
    expect(drinks).toHaveLength(1)
    expect(drinks[0].id).toBe(orderId)
    expect(drinks[0].lines.map((l: Json) => [l.product_name, l.quantity, l.station])).toEqual([['Malteada Moka', 2, 'drinks']])
    expect((await kitchen(grillSecret))[0].lines.map((l: Json) => l.product_name)).toEqual(['Hamburguesa Sencilla'])

    await markReady(grillSecret, orderId)
    const food = await ready()
    expect(food).toHaveLength(1)
    expect(food[0].lines.map((l: Json) => [l.product_name, l.station])).toEqual([
      ['Hamburguesa Sencilla', 'grill'],
      ['Refresco', null],
    ])
    expect(food[0].pending_stations).toEqual(['drinks'])

    await markReady(drinksSecret, orderId)
    expect(await kitchen(drinksSecret)).toEqual([])
    const delivery = await ready()
    expect(delivery).toHaveLength(1)
    expect(delivery[0].lines.map((l: Json) => [l.product_name, l.station])).toEqual([
      ['Hamburguesa Sencilla', 'grill'],
      ['Malteada Moka', 'drinks'],
      ['Refresco', null],
    ])
    expect(delivery[0].pending_stations).toEqual([])
  })

  it('cannot mark another station lines from the drinks device', async () => {
    const orderId = await createOrder([{ product_id: burgerId, quantity: 1 }])
    const grillLines = (await kitchen(grillSecret))[0].lines.map((l: Json) => l.id)

    await rpc(db, 'public.device_mark_station_ready($1, $2, $3)', [drinksSecret, orderId, grillLines])

    expect((await kitchen(grillSecret))[0].lines.map((l: Json) => l.id)).toEqual(grillLines)
  })

  it('lets admin view the drinks station and still rejects unknown stations', async () => {
    const orderId = await createOrder([{ product_id: shakeId, quantity: 1 }])
    await asUser(db, admin)

    const orders = await rpc(db, `public.list_kitchen_orders('drinks')`)
    expect(orders.map((o: Json) => o.id)).toEqual([orderId])
    await expect(rpc(db, `public.list_kitchen_orders('bar')`)).rejects.toThrow('Estación inválida.')
  })
})
