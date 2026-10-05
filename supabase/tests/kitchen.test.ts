// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asSuperuser, asUser, createProfile, createTestDb, type TestDb } from './db.ts'

type Json = Record<string, any>

async function rpc(db: TestDb, sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

const DEVICE_ERROR = 'Este dispositivo no está autorizado para pedidos.'

let db: TestDb
let admin: string
let cashier: string
let waiterUser: string
let burgerId: string
let botanaId: string
let drinkId: string
let waiterSecret: string
let pizzaSecret: string
let grillSecret: string
let token: string
let styleId: string

function pizzaLine() {
  return {
    type: 'pizza',
    quantity: 1,
    pizza: {
      size: 'grande',
      portions: [{ style_id: styleId, ingredient_ids: [], extra_ingredient_ids: [], extra_cheese: false }],
    },
  }
}

async function createOrder(items: Json[], table = 2): Promise<string> {
  await asAnon(db)
  const res = await rpc(db, 'public.device_create_order($1, $2, $3, $4, $5::jsonb)', [
    waiterSecret,
    token,
    table,
    null,
    JSON.stringify(items),
  ])
  return res.order_id as string
}

async function addItems(orderId: string, items: Json[]) {
  await asAnon(db)
  await rpc(db, 'public.device_add_order_items($1, $2, $3, $4::jsonb)', [waiterSecret, token, orderId, JSON.stringify(items)])
}

const kitchen = (secret: string) => rpc(db, 'public.device_list_kitchen_orders($1)', [secret])
const ready = () => rpc(db, 'public.device_list_ready_orders($1, $2)', [waiterSecret, token])
const markReadyLines = (secret: string, orderId: string, lineIds: string[] | null) =>
  rpc(db, 'public.device_mark_station_ready($1, $2, $3)', [secret, orderId, lineIds])

// Marks the lines currently listed for the order, like a cook who just refreshed the board.
async function markReady(secret: string, orderId: string) {
  const order = (await kitchen(secret)).find((o: Json) => o.id === orderId)
  return markReadyLines(secret, orderId, (order?.lines ?? []).map((l: Json) => l.id))
}
const markDelivered = (orderId: string) => rpc(db, 'public.device_mark_delivered($1, $2, $3)', [waiterSecret, token, orderId])

beforeEach(async () => {
  db = await createTestDb()
  await asSuperuser(db)
  const cats = await db.query<{ id: string; name: string }>(
    `insert into public.categories (name, sort_order) values ('Hamburguesas', 101), ('Botanas', 102), ('Bebidas', 103) returning id, name`,
  )
  const catId = (n: string) => cats.rows.find((c) => c.name === n)!.id
  const prods = await db.query<{ id: string; name: string }>(
    `insert into public.products (category_id, name, price_cents, active, variants) values
       ($1, 'Hamburguesa Sencilla', 8000, true, '{}'),
       ($2, 'Alitas', 9000, true, '{}'),
       ($3, 'Refresco', 2000, true, '{}') returning id, name`,
    [catId('Hamburguesas'), catId('Botanas'), catId('Bebidas')],
  )
  const pid = (n: string) => prods.rows.find((p) => p.name === n)!.id
  burgerId = pid('Hamburguesa Sencilla')
  botanaId = pid('Alitas')
  drinkId = pid('Refresco')
  styleId = (await db.query<{ id: string }>(`select id from public.pizza_styles where name = 'Estilo Varas'`)).rows[0].id

  admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  waiterUser = await createProfile(db, { role: 'waiter', fullName: 'Mesero' })
  await asUser(db, admin)
  const waiterId = (await rpc(db, 'public.admin_create_waiter($1, $2)', ['Luis', '1234'])).waiter_id
  waiterSecret = (await rpc(db, 'public.admin_register_device($1)', ['Tablet 1'])).device_secret
  pizzaSecret = (await rpc(db, 'public.admin_register_device($1, $2)', ['Horno', 'kitchen_pizza'])).device_secret
  grillSecret = (await rpc(db, 'public.admin_register_device($1, $2)', ['Plancha', 'kitchen_grill'])).device_secret
  await asAnon(db)
  token = (await rpc(db, 'public.device_start_shift($1, $2, $3)', [waiterSecret, waiterId, '1234'])).token
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('station assignment', () => {
  it('backfills categories by normalized name', async () => {
    // No categories exist when migrations run, so re-run the migration's backfill statement.
    const sql = readFileSync(join(import.meta.dirname, '..', 'migrations', '20261014120000_kitchen_stations.sql'), 'utf8')
    const backfill = sql.match(/update public\.categories\nset kitchen_station = case[\s\S]*?end;/)![0]
    await asSuperuser(db)
    const names = ['Pizzas', 'Rebanadas-Pizza', 'Ensaladas', 'Extras', 'Postres'] // Hamburguesas/Botanas/Bebidas exist from beforeEach
    for (const n of names) await db.query(`insert into public.categories (name, sort_order) values ($1, 200)`, [n])
    await db.query(`update public.categories set kitchen_station = null`)
    await db.exec(backfill)
    const res = await db.query<{ name: string; kitchen_station: string | null }>(
      `select name, kitchen_station from public.categories where sort_order = 200 or name in ('Hamburguesas','Botanas','Bebidas')`,
    )
    const station = Object.fromEntries(res.rows.map((r) => [r.name, r.kitchen_station]))
    expect(station).toEqual({
      Pizzas: 'pizza',
      'Rebanadas-Pizza': 'pizza',
      Hamburguesas: 'grill',
      Botanas: 'grill',
      Ensaladas: 'grill',
      Bebidas: null,
      Extras: null,
      Postres: null,
    })
  })

  it('stamps stations on lines at create and add time; drinks are ready immediately', async () => {
    await asSuperuser(db)
    await db.query(`update public.categories set kitchen_station = 'grill' where name in ('Hamburguesas','Botanas')`)
    const id = await createOrder([
      pizzaLine(),
      { product_id: burgerId, quantity: 1 },
      { product_id: drinkId, quantity: 2 },
    ])
    await addItems(id, [{ product_id: botanaId, quantity: 1 }])

    await asSuperuser(db)
    const lines = await db.query<{ item_type: string; product_name: string; station: string | null; ready_at: string | null; delivered_at: string | null }>(
      `select item_type, product_name, station, ready_at, delivered_at from public.order_items where order_id = $1`,
      [id],
    )
    const byName = (n: string) => lines.rows.find((l) => l.product_name.startsWith(n))!
    expect(byName('Pizza').station).toBe('pizza')
    expect(byName('Pizza').ready_at).toBeNull()
    expect(byName('Hamburguesa').station).toBe('grill')
    expect(byName('Hamburguesa').ready_at).toBeNull()
    expect(byName('Alitas').station).toBe('grill')
    expect(byName('Alitas').ready_at).toBeNull()
    expect(byName('Refresco').station).toBeNull()
    expect(byName('Refresco').ready_at).not.toBeNull()
    expect(byName('Refresco').delivered_at).toBeNull()
  })

  it('rejects an invalid station value', async () => {
    await asSuperuser(db)
    await expect(db.query(`update public.categories set kitchen_station = 'bar' where name = 'Bebidas'`)).rejects.toThrow()
  })
})

describe('kitchen and delivery flow', () => {
  beforeEach(async () => {
    await asSuperuser(db)
    await db.query(`update public.categories set kitchen_station = 'grill' where name in ('Hamburguesas','Botanas')`)
  })

  it('splits a mixed order by station and reaches delivery only when every station is done', async () => {
    const id = await createOrder([pizzaLine(), { product_id: burgerId, quantity: 2 }, { product_id: drinkId, quantity: 1 }])
    await asAnon(db)

    const p = await kitchen(pizzaSecret)
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ id, table_number: 2, waiter_name: 'Luis' })
    expect(p[0].lines).toHaveLength(1)
    expect(p[0].lines[0]).toMatchObject({ item_type: 'pizza', quantity: 1 })
    expect(p[0].lines[0].pizza.size).toBe('grande')

    const g = await kitchen(grillSecret)
    expect(g).toHaveLength(1)
    expect(g[0].lines).toHaveLength(1)
    expect(g[0].lines[0]).toMatchObject({ product_name: 'Hamburguesa Sencilla', quantity: 2, item_type: 'product' })
    expect(Object.keys(g[0].lines[0]).sort()).toEqual(
      ['id', 'item_type', 'notes', 'pizza', 'product_name', 'quantity', 'variant'].sort(),
    )

    expect(await ready()).toEqual([])

    await markReady(pizzaSecret, id)
    expect(await kitchen(pizzaSecret)).toEqual([])
    expect(await kitchen(grillSecret)).toHaveLength(1)
    expect(await ready()).toEqual([])

    await markReady(grillSecret, id)
    expect(await kitchen(grillSecret)).toEqual([])
    const r = await ready()
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe(id)
    expect(r[0].lines).toHaveLength(3)

    await markDelivered(id)
    expect(await ready()).toEqual([])
  })

  it('sends orders without kitchen lines straight to delivery', async () => {
    const id = await createOrder([{ product_id: drinkId, quantity: 1 }])
    await asAnon(db)
    expect(await kitchen(pizzaSecret)).toEqual([])
    expect(await kitchen(grillSecret)).toEqual([])
    const r = await ready()
    expect(r.map((o: Json) => o.id)).toEqual([id])
  })

  it('brings an order back to the kitchen when items are added later', async () => {
    const id = await createOrder([{ product_id: burgerId, quantity: 1 }])
    await asAnon(db)
    await markReady(grillSecret, id)
    expect(await ready()).toHaveLength(1)

    // Same product again must not be merged into the already-cooked line.
    await addItems(id, [{ product_id: burgerId, quantity: 1 }, pizzaLine()])
    await asAnon(db)
    expect(await ready()).toEqual([])
    const g = await kitchen(grillSecret)
    expect(g).toHaveLength(1)
    expect(g[0].lines).toHaveLength(1)
    expect(g[0].lines[0].quantity).toBe(1)
    expect(await kitchen(pizzaSecret)).toHaveLength(1)

    await markReady(grillSecret, id)
    await markReady(pizzaSecret, id)
    const r = await ready()
    expect(r).toHaveLength(1)
    expect(r[0].lines).toHaveLength(3)
  })

  it('marks only the lines the cook was shown, not ones added afterwards', async () => {
    const id = await createOrder([{ product_id: burgerId, quantity: 1 }])
    await asAnon(db)
    const shown = (await kitchen(grillSecret))[0].lines.map((l: Json) => l.id)
    expect(shown).toHaveLength(1)

    // A different product: the same one would merge into the still-pending line.
    await addItems(id, [{ product_id: botanaId, quantity: 1 }])
    await asAnon(db)
    const res = await markReadyLines(grillSecret, id, shown)
    expect(res).toEqual({ order_id: id })

    const g = await kitchen(grillSecret)
    expect(g).toHaveLength(1)
    expect(g[0].lines).toHaveLength(1)
    expect(g[0].lines[0].id).not.toBe(shown[0])
    expect(g[0].lines[0].product_name).toBe('Alitas')
    expect(await ready()).toEqual([])
  })

  it('never merges a repeated station product into the line the cook was shown', async () => {
    const id = await createOrder([{ product_id: burgerId, quantity: 1 }])
    await asAnon(db)
    const shown = (await kitchen(grillSecret))[0].lines.map((l: Json) => l.id)

    await addItems(id, [{ product_id: burgerId, quantity: 1 }])
    await asAnon(db)
    await markReadyLines(grillSecret, id, shown)

    const g = await kitchen(grillSecret)
    expect(g).toHaveLength(1)
    expect(g[0].lines).toHaveLength(1)
    expect(g[0].lines[0]).toMatchObject({ product_name: 'Hamburguesa Sencilla', quantity: 1 })
    expect(g[0].lines[0].id).not.toBe(shown[0])
    expect(await ready()).toEqual([])
  })

  it('ignores line ids from another station or order and rejects empty ids', async () => {
    const id = await createOrder([pizzaLine(), { product_id: burgerId, quantity: 1 }])
    const other = await createOrder([{ product_id: burgerId, quantity: 1 }], 5)
    await asAnon(db)
    const pizzaIds = (await kitchen(pizzaSecret))[0].lines.map((l: Json) => l.id)
    const otherGrill = (await kitchen(grillSecret)).find((o: Json) => o.id === other).lines.map((l: Json) => l.id)

    await markReadyLines(grillSecret, id, [...pizzaIds, ...otherGrill])
    expect(await kitchen(pizzaSecret)).toHaveLength(1)
    expect((await kitchen(grillSecret)).map((o: Json) => o.id).sort()).toEqual([id, other].sort())

    await expect(markReadyLines(grillSecret, id, [])).rejects.toThrow('Indica las líneas del pedido.')
    await expect(markReadyLines(grillSecret, id, null)).rejects.toThrow('Indica las líneas del pedido.')
  })

  it('lists only undelivered lines once part of the order was delivered', async () => {
    const id = await createOrder([{ product_id: burgerId, quantity: 1 }])
    await asAnon(db)
    await markReady(grillSecret, id)
    await markDelivered(id)
    await addItems(id, [pizzaLine()])
    await asAnon(db)
    await markReady(pizzaSecret, id)
    const r = await ready()
    expect(r).toHaveLength(1)
    expect(r[0].lines).toHaveLength(1)
    expect(r[0].lines[0].item_type).toBe('pizza')
  })

  it('lists kitchen orders oldest first and hides non-open orders', async () => {
    const a = await createOrder([{ product_id: burgerId, quantity: 1 }], 1)
    const b = await createOrder([{ product_id: burgerId, quantity: 1 }], 2)
    const c = await createOrder([{ product_id: burgerId, quantity: 1 }], 3)
    await asAnon(db)
    await rpc(db, 'public.device_cancel_order($1, $2, $3)', [waiterSecret, token, c])
    expect((await kitchen(grillSecret)).map((o: Json) => o.id)).toEqual([a, b])
    await expect(markReadyLines(grillSecret, c, [crypto.randomUUID()])).rejects.toThrow('El pedido ya no está abierto.')
  })

  it('exposes station fields in device_list_open_orders', async () => {
    await createOrder([{ product_id: burgerId, quantity: 1 }])
    await asAnon(db)
    const open = await rpc(db, 'public.device_list_open_orders($1)', [waiterSecret])
    expect(open[0].order_items[0]).toMatchObject({ station: 'grill', ready_at: null, delivered_at: null })
  })
})

describe('device kinds', () => {
  it('returns kind from device_info and admin_list_devices; rejects invalid kinds', async () => {
    await asAnon(db)
    expect((await rpc(db, 'public.device_info($1)', [waiterSecret])).kind).toBe('waiter')
    expect((await rpc(db, 'public.device_info($1)', [pizzaSecret])).kind).toBe('kitchen_pizza')
    await asUser(db, admin)
    const list = await rpc(db, 'public.admin_list_devices()')
    expect(list.map((d: Json) => d.kind).sort()).toEqual(['kitchen_grill', 'kitchen_pizza', 'waiter'])
    await expect(rpc(db, 'public.admin_register_device($1, $2)', ['X', 'bar'])).rejects.toThrow()
  })

  it('keeps registering waiter devices without a kind', async () => {
    await asUser(db, admin)
    const d = await rpc(db, 'public.admin_register_device($1)', ['Otra'])
    await asAnon(db)
    expect((await rpc(db, 'public.device_info($1)', [d.device_secret])).kind).toBe('waiter')
  })

  it('blocks kitchen devices from waiter RPCs', async () => {
    await asAnon(db)
    const msg = 'Este dispositivo no es de mesero.'
    await expect(rpc(db, 'public.device_list_waiters($1)', [pizzaSecret])).rejects.toThrow(msg)
    await expect(rpc(db, 'public.device_list_catalog($1)', [grillSecret])).rejects.toThrow(msg)
    await expect(rpc(db, 'public.device_list_open_orders($1)', [grillSecret])).rejects.toThrow(msg)
    await expect(rpc(db, 'public.device_start_shift($1, $2, $3)', [pizzaSecret, crypto.randomUUID(), '1234'])).rejects.toThrow(msg)
    await expect(
      rpc(db, 'public.device_create_order($1, $2, $3, $4, $5::jsonb)', [
        pizzaSecret, token, 1, null, JSON.stringify([{ product_id: drinkId, quantity: 1 }]),
      ]),
    ).rejects.toThrow(msg)
    await expect(rpc(db, 'public.device_list_ready_orders($1, $2)', [pizzaSecret, token])).rejects.toThrow(msg)
    await expect(rpc(db, 'public.device_mark_delivered($1, $2, $3)', [grillSecret, token, crypto.randomUUID()])).rejects.toThrow(msg)
  })

  it('blocks waiter devices and the wrong station from kitchen RPCs', async () => {
    const id = await createOrder([{ product_id: burgerId, quantity: 1 }])
    await asAnon(db)
    const msg = 'Este dispositivo no es de cocina.'
    await expect(kitchen(waiterSecret)).rejects.toThrow(msg)
    await expect(markReadyLines(waiterSecret, id, [crypto.randomUUID()])).rejects.toThrow(msg)
  })

  it('rejects invalid secrets and invalid shift tokens', async () => {
    await asAnon(db)
    await expect(kitchen('x'.repeat(64))).rejects.toThrow(DEVICE_ERROR)
    await expect(markReadyLines('short', crypto.randomUUID(), [crypto.randomUUID()])).rejects.toThrow(DEVICE_ERROR)
    await expect(rpc(db, 'public.device_list_ready_orders($1, $2)', ['x'.repeat(64), token])).rejects.toThrow(DEVICE_ERROR)
    await expect(rpc(db, 'public.device_list_ready_orders($1, $2)', [waiterSecret, crypto.randomUUID()])).rejects.toThrow(
      'Tu turno expiró. Ingresa tu PIN de nuevo.',
    )
    await expect(
      rpc(db, 'public.device_mark_delivered($1, $2, $3)', [waiterSecret, crypto.randomUUID(), crypto.randomUUID()]),
    ).rejects.toThrow('Tu turno expiró. Ingresa tu PIN de nuevo.')
  })
})

describe('authenticated variants', () => {
  beforeEach(async () => {
    await asSuperuser(db)
    await db.query(`update public.categories set kitchen_station = 'grill' where name in ('Hamburguesas','Botanas')`)
  })

  it('lets a cashier list, mark ready and mark delivered', async () => {
    const id = await createOrder([pizzaLine(), { product_id: burgerId, quantity: 1 }])
    await asUser(db, cashier)

    const p = await rpc(db, `public.list_kitchen_orders($1)`, ['pizza'])
    expect(p).toHaveLength(1)
    expect(p[0].lines).toHaveLength(1)
    expect(p[0].lines[0].item_type).toBe('pizza')
    expect(await rpc(db, `public.list_ready_orders()`)).toEqual([])

    const lineIds = async (station: string) =>
      (await rpc(db, `public.list_kitchen_orders($1)`, [station]))[0].lines.map((l: Json) => l.id)
    await rpc(db, `public.mark_station_ready($1, $2, $3)`, [id, 'pizza', await lineIds('pizza')])
    await rpc(db, `public.mark_station_ready($1, $2, $3)`, [id, 'grill', await lineIds('grill')])
    expect(await rpc(db, `public.list_kitchen_orders($1)`, ['grill'])).toEqual([])
    const r = await rpc(db, `public.list_ready_orders()`)
    expect(r).toHaveLength(1)
    expect(r[0].lines).toHaveLength(2)

    await rpc(db, `public.mark_delivered($1)`, [id])
    expect(await rpc(db, `public.list_ready_orders()`)).toEqual([])
  })

  it('rejects waiter role, anon, and invalid stations', async () => {
    const id = await createOrder([{ product_id: burgerId, quantity: 1 }])
    await asUser(db, waiterUser)
    const msg = 'No tienes permiso para operar la caja.'
    await expect(rpc(db, `public.list_kitchen_orders($1)`, ['grill'])).rejects.toThrow(msg)
    await expect(
      rpc(db, `public.mark_station_ready($1, $2, $3)`, [id, 'grill', [crypto.randomUUID()]]),
    ).rejects.toThrow(msg)
    await expect(rpc(db, `public.list_ready_orders()`)).rejects.toThrow(msg)
    await expect(rpc(db, `public.mark_delivered($1)`, [id])).rejects.toThrow(msg)

    await asAnon(db)
    await expect(rpc(db, `public.list_ready_orders()`)).rejects.toThrow()

    await asUser(db, cashier)
    await expect(rpc(db, `public.list_kitchen_orders($1)`, ['bar'])).rejects.toThrow('Estación inválida.')
  })
})
