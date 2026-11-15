// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>
let db: TestDb
let styleIds: Record<string, string>
let cashier: string
let admin: string
let catId: string

async function rpc(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}
function pizza(size: string, styles: string[]) {
  return { size, portions: styles.map((style) => ({ style_id: styleIds[style], ingredient_ids: [], extra_ingredient_ids: [] })) }
}
const pizzaLine = (config: Json, quantity = 1) => ({ type: 'pizza', pizza: config, quantity, notes: null })
const productLine = (id: string, quantity = 1, variant?: string) => ({ product_id: id, quantity, ...(variant === undefined ? {} : { variant }) })
async function createOrder(items: Json[]) {
  await asUser(db, cashier)
  return (await rpc('public.create_order($1, $2, $3::jsonb, $4)', [3, null, JSON.stringify(items), null])).order_id as string
}
async function sell(items: Json[]) {
  const id = await createOrder(items)
  await asUser(db, cashier)
  await rpc('public.pay_order($1, $2)', [id, 9_999_999])
  return id
}
async function paidAgo(id: string, interval: string) {
  await asSuperuser(db)
  await db.query(`update public.orders set paid_at = now() - $2::interval where id = $1`, [id, interval])
}
async function picks() {
  await asUser(db, cashier)
  return (await rpc('public.list_popular_picks()')) as unknown as Json[]
}
async function insertProduct(name: string, variants: string[] = [], extra = '') {
  await asSuperuser(db)
  const r = await db.query<{ id: string }>(
    `insert into public.products (category_id, name, price_cents, active, variants) values ($1, $2, 3000, true, $3) returning id`,
    [catId, name, variants],
  )
  if (extra) await db.query(`update public.products set ${extra} where id = $1`, [r.rows[0].id])
  return r.rows[0].id
}
async function device(kind = 'waiter') {
  await asUser(db, admin)
  return (await rpc('public.admin_register_device($1, $2)', ['T ' + kind, kind])) as Json
}

beforeEach(async () => {
  db = await createTestDb()
  await loadFixture(db)
  await asSuperuser(db)
  const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
  styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
  catId = (await db.query<{ id: string }>(`insert into public.categories (name, sort_order) values ('Bebidas', 10) returning id`)).rows[0].id
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  await asUser(db, cashier)
  await rpc('public.open_cash_session($1)', [0])
}, 60_000)
afterEach(async () => { await db.close() })

describe('security', () => {
  it('grants: popular_picks no execute for public/anon/authenticated; list only authenticated; device anon+auth', async () => {
    await asSuperuser(db)
    const r = await db.query<Json>(`select
      has_function_privilege('anon','public.popular_picks(integer)','execute') a1,
      has_function_privilege('authenticated','public.popular_picks(integer)','execute') a2,
      has_function_privilege('anon','public.list_popular_picks()','execute') b1,
      has_function_privilege('authenticated','public.list_popular_picks()','execute') b2,
      has_function_privilege('anon','public.device_list_popular_picks(text)','execute') c1,
      has_function_privilege('authenticated','public.device_list_popular_picks(text)','execute') c2,
      (select prosecdef from pg_proc where proname='popular_picks') d1,
      (select proconfig from pg_proc where proname='device_list_popular_picks') d2`)
    expect(r.rows[0]).toEqual({ a1: false, a2: false, b1: false, b2: true, c1: true, c2: true, d1: true, d2: ['search_path=public'] })
  })

  it('list_popular_picks: anon denied, waiter and profile-less user denied, admin allowed', async () => {
    await asAnon(db)
    await expect(rpc('public.list_popular_picks()')).rejects.toThrow('permission denied')
    const waiter = await createProfile(db, { role: 'waiter', fullName: 'M' })
    await asUser(db, waiter)
    await expect(rpc('public.list_popular_picks()')).rejects.toThrow('No tienes permiso para ver los productos más vendidos.')
    await asUser(db, crypto.randomUUID())
    await expect(rpc('public.list_popular_picks()')).rejects.toThrow('No tienes permiso')
    await asUser(db, admin)
    expect(await rpc('public.list_popular_picks()')).toEqual([])
  })

  it('device: unknown, short, null, revoked and kitchen devices are rejected; waiter accepted', async () => {
    const id = await insertProduct('Papas')
    await sell([productLine(id, 2)])
    const w = await device('waiter')
    const k = await device('kitchen_pizza')
    const d = await device('kitchen_drinks')
    const rv = await device('waiter')
    await asUser(db, admin)
    await rpc('public.admin_revoke_device($1)', [rv.device_id])
    await asAnon(db)
    await expect(rpc('public.device_list_popular_picks($1)', [null])).rejects.toThrow('no está autorizado')
    await expect(rpc('public.device_list_popular_picks($1)', ['x'])).rejects.toThrow('no está autorizado')
    await expect(rpc('public.device_list_popular_picks($1)', ['a'.repeat(64)])).rejects.toThrow('no está autorizado')
    await expect(rpc('public.device_list_popular_picks($1)', [rv.device_secret])).rejects.toThrow('no está autorizado')
    await expect(rpc('public.device_list_popular_picks($1)', [k.device_secret])).rejects.toThrow('no es de mesero')
    await expect(rpc('public.device_list_popular_picks($1)', [d.device_secret])).rejects.toThrow('no es de mesero')
    expect(await rpc('public.device_list_popular_picks($1)', [w.device_secret])).toEqual([{ kind: 'product', product_id: id, variant: null, sold: 2 }])
  })

  it('leaks only kind/ids/variant/sold/pizza keys', async () => {
    const coke = await insertProduct('Coca', ['600 ml'])
    await asUser(db, admin)
    await rpc('public.admin_add_quick_pizza($1::jsonb)', [JSON.stringify(pizza('chica', ['Estilo Varas']))])
    await sell([pizzaLine(pizza('grande', ['Estilo Varas']), 2), productLine(coke, 1, '600 ml')])
    const w = await device()
    await asAnon(db)
    const out = (await rpc('public.device_list_popular_picks($1)', [w.device_secret])) as unknown as Json[]
    const keys = new Set(out.flatMap((o) => Object.keys(o)))
    expect([...keys].sort()).toEqual(['kind', 'pizza', 'product_id', 'sold', 'variant'])
    expect(JSON.stringify(out)).not.toMatch(/price|cents|total|name|waiter|customer|order_id/i)
  })
})

describe('correctness', () => {
  it('canonicalizes case-insensitively to the current variant spelling and merges', async () => {
    const coke = await insertProduct('Coca', ['600 ml', '2 L'])
    await sell([productLine(coke, 2, '600 ML')])
    await asSuperuser(db)
    await db.query(`update public.products set variants = '{600 Ml,2 L}' where id = $1`, [coke])
    await sell([productLine(coke, 1, '600 ml')])
    expect(await picks()).toEqual([{ kind: 'product', product_id: coke, variant: '600 Ml', sold: 3 }])
  })

  it('a product whose variants were removed merges old variant lines under null', async () => {
    const p = await insertProduct('Papas', ['Chicas', 'Grandes'])
    await sell([productLine(p, 2, 'Chicas'), productLine(p, 1, 'Grandes')])
    await asSuperuser(db)
    await db.query(`update public.products set variants = '{}' where id = $1`, [p])
    await sell([productLine(p, 1)])
    expect(await picks()).toEqual([{ kind: 'product', product_id: p, variant: null, sold: 4 }])
  })

  it('a product that gained variants drops old variant-less lines', async () => {
    const p = await insertProduct('Agua')
    await sell([productLine(p, 5)])
    await asSuperuser(db)
    await db.query(`update public.products set variants = '{1 L}' where id = $1`, [p])
    await sell([productLine(p, 1, '1 L')])
    expect(await picks()).toEqual([{ kind: 'product', product_id: p, variant: '1 L', sold: 1 }])
  })

  it('stock: tracked with stock shown; untracked with stock 0 shown; tracked stock 0 hidden', async () => {
    const a = await insertProduct('A', [], 'track_stock = true, stock = 50')
    const b = await insertProduct('B')
    await sell([productLine(a, 3), productLine(b, 2)])
    await asSuperuser(db)
    await db.query(`update public.products set stock = 0 where id = $1`, [b])
    expect((await picks()).map((p) => p.product_id)).toEqual([a, b])
    await asSuperuser(db)
    await db.query(`update public.products set stock = 0 where id = $1`, [a])
    expect((await picks()).map((p) => p.product_id)).toEqual([b])
  })

  it('30-day window boundary and unpaid orders', async () => {
    const a = await insertProduct('A'); const b = await insertProduct('B'); const c = await insertProduct('C')
    const oa = await sell([productLine(a, 1)]); await paidAgo(oa, '29 days 23 hours')
    const ob = await sell([productLine(b, 1)]); await paidAgo(ob, '30 days 1 minute')
    await createOrder([productLine(c, 9)])
    expect((await picks()).map((p) => p.product_id)).toEqual([a])
  })

  it('ties: most recent sale first across pizza and product; fixed pizza not duplicated; fixed then sold desc', async () => {
    const chica = pizza('chica', ['Estilo Varas'])
    const grande = pizza('grande', ['Estilo Varas'])
    await asUser(db, admin)
    await rpc('public.admin_add_quick_pizza($1::jsonb)', [JSON.stringify(chica)])
    const a = await insertProduct('A'); const b = await insertProduct('B')
    const o1 = await sell([productLine(a, 2), pizzaLine(chica, 50)]); await paidAgo(o1, '3 days')
    const o2 = await sell([pizzaLine(grande, 2)]); await paidAgo(o2, '2 days')
    const o3 = await sell([productLine(b, 2)]); await paidAgo(o3, '1 day')
    const r = await picks()
    expect(r.map((p) => [p.kind, p.product_id ?? null, p.sold])).toEqual([
      ['pizza', null, null], ['product', b, 2], ['pizza', null, 2], ['product', a, 2],
    ])
  })

  it('deleted product lines (product_id null) and legacy pizza category are skipped', async () => {
    await asSuperuser(db)
    const lc = (await db.query<{ id: string }>(`insert into public.categories (name, sort_order, legacy_pizza) values ('Viejas', 20, true) returning id`)).rows[0].id
    const legacy = (await db.query<{ id: string }>(`insert into public.products (category_id, name, price_cents, active) values ($1, 'Pizza P', 100, true) returning id`, [lc])).rows[0].id
    const del = await insertProduct('Del'); const keep = await insertProduct('Keep')
    await sell([productLine(legacy, 5), productLine(del, 4), productLine(keep, 1)])
    await asSuperuser(db)
    await db.query(`delete from public.products where id = $1`, [del])
    const nulls = await db.query<Json>(`select count(*)::int n from public.order_items where product_id is null and item_type = 'product'`)
    expect(nulls.rows[0].n).toBeGreaterThan(0)
    expect((await picks()).map((p) => p.product_id)).toEqual([keep])
  })
})
