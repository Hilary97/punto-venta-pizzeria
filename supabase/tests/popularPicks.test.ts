// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

let db: TestDb
let styleIds: Record<string, string>
let cashier: string
let admin: string
let drinksId: string
let snacksId: string
let cokeId: string
let friesId: string
let burgerId: string

async function rpc(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

function pizza(size: string, styles: string[]) {
  return { size, portions: styles.map((style) => ({ style_id: styleIds[style], ingredient_ids: [], extra_ingredient_ids: [] })) }
}

function pizzaLine(config: Json, quantity = 1) {
  return { type: 'pizza', pizza: config, quantity, notes: null }
}

function productLine(productId: string, quantity = 1, variant?: string) {
  return { product_id: productId, quantity, ...(variant === undefined ? {} : { variant }) }
}

async function createOrder(items: Json[]): Promise<string> {
  await asUser(db, cashier)
  const res = await rpc('public.create_order($1, $2, $3::jsonb, $4)', [3, null, JSON.stringify(items), null])
  return res.order_id as string
}

async function sell(items: Json[]): Promise<string> {
  const id = await createOrder(items)
  await asUser(db, cashier)
  await rpc('public.pay_order($1, $2)', [id, 99_999_999])
  return id
}

async function paidDaysAgo(orderId: string, days: number) {
  await asSuperuser(db)
  await db.query(`update public.orders set paid_at = now() - make_interval(days => $2) where id = $1`, [orderId, days])
}

async function canonical(config: Json) {
  await asSuperuser(db)
  return rpc('public.validate_pizza($1::jsonb)', [JSON.stringify(config)])
}

// Distinct single and two-style configs of a size that validate_pizza accepts.
async function validConfigs(size: string): Promise<Json[]> {
  const ids = Object.values(styleIds)
  const candidates: Json[] = ids.map((id) => ({ size, portions: [{ style_id: id, ingredient_ids: [], extra_ingredient_ids: [] }] }))
  for (let i = 0; i + 1 < ids.length; i++) {
    candidates.push({
      size,
      portions: [ids[i], ids[i + 1]].map((id) => ({ style_id: id, ingredient_ids: [], extra_ingredient_ids: [] })),
    })
  }
  const valid: Json[] = []
  await asSuperuser(db)
  for (const c of candidates) {
    try {
      await rpc('public.validate_pizza($1::jsonb)', [JSON.stringify(c)])
      valid.push(c)
    } catch {
      // not offered for this size
    }
  }
  return valid
}

async function picks() {
  await asUser(db, cashier)
  return (await rpc('public.list_popular_picks()')) as unknown as Json[]
}

async function insertProduct(categoryId: string, name: string, variants: string[] = []): Promise<string> {
  await asSuperuser(db)
  const res = await db.query<{ id: string }>(
    `insert into public.products (category_id, name, price_cents, active, variants)
     values ($1, $2, 3000, true, $3) returning id`,
    [categoryId, name, variants],
  )
  return res.rows[0].id
}

beforeEach(async () => {
  db = await createTestDb()
  await loadFixture(db)
  await asSuperuser(db)
  const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
  styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
  const cats = await db.query<{ id: string }>(
    `insert into public.categories (name, sort_order) values ('Bebidas', 10), ('Botanas', 11) returning id`,
  )
  ;[drinksId, snacksId] = cats.rows.map((r) => r.id)
  cokeId = await insertProduct(drinksId, 'Coca', ['600 ml', '2 L'])
  friesId = await insertProduct(snacksId, 'Papas')
  burgerId = await insertProduct(snacksId, 'Hamburguesa')
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  await asUser(db, cashier)
  await rpc('public.open_cash_session($1)', [0])
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('list_popular_picks', () => {
  it('returns an empty list when nothing was sold', async () => {
    expect(await picks()).toEqual([])
  })

  it('mixes pizzas and products (one per product and variant) ranked by units sold', async () => {
    const varas = pizza('grande', ['Estilo Varas'])
    const first = await sell([pizzaLine(varas, 2), productLine(cokeId, 3, '600 ml'), productLine(friesId, 1)])
    await sell([productLine(cokeId, 1, '2 L'), productLine(friesId, 1)])
    await paidDaysAgo(first, 2)

    expect(await picks()).toEqual([
      { kind: 'product', product_id: cokeId, variant: '600 ml', sold: 3 },
      { kind: 'product', product_id: friesId, variant: null, sold: 2 },
      { kind: 'pizza', pizza: await canonical(varas), sold: 2 },
      { kind: 'product', product_id: cokeId, variant: '2 L', sold: 1 },
    ])
  })

  it('breaks ties by the most recent sale', async () => {
    const varas = pizza('grande', ['Estilo Varas'])
    const older = await sell([pizzaLine(varas)])
    await sell([productLine(friesId)])
    await paidDaysAgo(older, 2)

    expect((await picks()).map((p) => p.kind)).toEqual(['product', 'pizza'])
  })

  it('counts only paid orders of the last 30 days', async () => {
    const old = await sell([productLine(burgerId, 5)])
    await paidDaysAgo(old, 31)
    await sell([productLine(friesId)])
    const cancelled = await createOrder([productLine(cokeId, 4, '600 ml')])
    await asUser(db, cashier)
    await rpc('public.cancel_order($1)', [cancelled])
    await createOrder([productLine(cokeId, 6, '2 L')])

    expect(await picks()).toEqual([{ kind: 'product', product_id: friesId, variant: null, sold: 1 }])
  })

  it('skips inactive, sold-out, legacy pizza and deleted products and variants no longer offered', async () => {
    await asSuperuser(db)
    const legacyCat = await db.query<{ id: string }>(
      `insert into public.categories (name, sort_order, legacy_pizza) values ('Pizzas viejas', 20, true) returning id`,
    )
    const legacyPizza = await insertProduct(legacyCat.rows[0].id, 'Pizza peperoni')
    const soldOut = await insertProduct(snacksId, 'Alitas')
    const deleted = await insertProduct(snacksId, 'Nachos')
    await sell([
      productLine(burgerId, 9),
      productLine(legacyPizza, 8),
      productLine(soldOut, 7),
      productLine(deleted, 6),
      productLine(cokeId, 5, '2 L'),
      productLine(cokeId, 4, '600 ml'),
      productLine(friesId, 1),
    ])
    await asSuperuser(db)
    await db.query(`update public.products set active = false where id = $1`, [burgerId])
    await db.query(`update public.products set track_stock = true, stock = 0 where id = $1`, [soldOut])
    await db.query(`update public.products set variants = '{600 ml}' where id = $1`, [cokeId])
    await db.query(`delete from public.products where id = $1`, [deleted])

    expect(await picks()).toEqual([
      { kind: 'product', product_id: cokeId, variant: '600 ml', sold: 4 },
      { kind: 'product', product_id: friesId, variant: null, sold: 1 },
    ])
  })

  it('puts the fixed admin pizzas first and cuts the list at 16', async () => {
    const varas = pizza('grande', ['Estilo Varas'])
    const chuys = pizza('chica', ['Estilo Varas'])
    await asUser(db, admin)
    await rpc('public.admin_add_quick_pizza($1::jsonb)', [JSON.stringify(chuys)])
    const products: string[] = []
    for (let i = 0; i < 20; i++) products.push(await insertProduct(snacksId, `Botana ${i}`))
    await sell([pizzaLine(varas, 30), pizzaLine(chuys, 40), ...products.map((id, i) => productLine(id, 20 - i))])

    const result = await picks()

    expect(result).toHaveLength(16)
    expect(result[0]).toEqual({ kind: 'pizza', pizza: await canonical(chuys), sold: null })
    expect(result[1]).toEqual({ kind: 'pizza', pizza: await canonical(varas), sold: 30 })
    expect(result.slice(2).map((p) => p.product_id)).toEqual(products.slice(0, 14))
  })

  it('skips pizzas whose size is out of dough so products still fill the list', async () => {
    const grandes = await validConfigs('grande')
    expect(grandes.length).toBeGreaterThanOrEqual(17)
    const snacks: string[] = []
    for (let i = 0; i < 8; i++) snacks.push(await insertProduct(snacksId, `Botana ${i}`))
    await sell([...grandes.map((c) => pizzaLine(c, 50)), ...snacks.map((id) => productLine(id, 1))])
    await asUser(db, admin)
    await rpc('public.admin_set_pizza_dough($1, $2)', ['grande', 0])
    const result = await picks()
    expect(result.filter((p) => p.kind === 'pizza')).toEqual([])
    expect(result.map((p) => p.product_id)).toEqual(expect.arrayContaining(snacks))
  })

  it('keeps pizzas of sizes with dough left or with no dough limit', async () => {
    const varas = pizza('grande', ['Estilo Varas'])
    const chica = pizza('chica', ['Estilo Varas'])
    await sell([pizzaLine(varas, 3), pizzaLine(chica, 2), productLine(friesId, 1)])
    expect((await picks()).map((p) => p.kind)).toEqual(['pizza', 'pizza', 'product'])

    await asUser(db, admin)
    await rpc('public.admin_set_pizza_dough($1, $2)', ['chica', 10])
    expect((await picks()).map((p) => p.kind)).toEqual(['pizza', 'pizza', 'product'])

    await asUser(db, admin)
    await rpc('public.admin_set_pizza_dough($1, $2)', ['grande', 0])
    expect(await picks()).toEqual([
      { kind: 'pizza', pizza: await canonical(chica), sold: 2 },
      { kind: 'product', product_id: friesId, variant: null, sold: 1 },
    ])
  })

  it('skips fixed admin pizzas of a size that is out of dough', async () => {
    const chica = pizza('chica', ['Estilo Varas'])
    const grande = pizza('grande', ['Estilo Varas'])
    await asUser(db, admin)
    await rpc('public.admin_add_quick_pizza($1::jsonb)', [JSON.stringify(chica)])
    await rpc('public.admin_add_quick_pizza($1::jsonb)', [JSON.stringify(grande)])
    await rpc('public.admin_set_pizza_dough($1, $2)', ['chica', 0])

    expect(await picks()).toEqual([{ kind: 'pizza', pizza: await canonical(grande), sold: null }])
  })

  it('is only for signed-in admins and cashiers', async () => {
    await asAnon(db)
    await expect(rpc('public.list_popular_picks()')).rejects.toThrow()
    const waiter = await createProfile(db, { role: 'waiter', fullName: 'Mesero' })
    await asUser(db, waiter)
    await expect(rpc('public.list_popular_picks()')).rejects.toThrow('No tienes permiso')
  })

  it('cannot call the internal popular_picks directly', async () => {
    await asUser(db, cashier)
    await expect(rpc('public.popular_picks(16)')).rejects.toThrow('permission denied')
    await asAnon(db)
    await expect(rpc('public.popular_picks(16)')).rejects.toThrow('permission denied')
  })
})

describe('device_list_popular_picks', () => {
  it('returns the list to an authorized waiter device and rejects an unknown secret', async () => {
    await sell([productLine(friesId, 2)])
    await asUser(db, admin)
    const secret = (await rpc('public.admin_register_device($1)', ['Tablet 1'])).device_secret

    await asAnon(db)
    expect(await rpc('public.device_list_popular_picks($1)', [secret])).toEqual([
      { kind: 'product', product_id: friesId, variant: null, sold: 2 },
    ])
    await asAnon(db)
    await expect(rpc('public.device_list_popular_picks($1)', ['nope'])).rejects.toThrow()
  })
})
