// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

let db: TestDb
let styleIds: Record<string, string>
let cashier: string

async function rpc(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

function pizza(size: string, styles: string[]) {
  return { size, portions: styles.map((style) => ({ style_id: styleIds[style], ingredient_ids: [], extra_ingredient_ids: [] })) }
}

function line(config: Json, quantity = 1, notes: string | null = null) {
  return { type: 'pizza', pizza: config, quantity, notes }
}

async function createOrder(items: Json[]): Promise<string> {
  await asUser(db, cashier)
  const res = await rpc('public.create_order($1, $2, $3::jsonb, $4)', [3, null, JSON.stringify(items), null])
  return res.order_id as string
}

async function sell(items: Json[]): Promise<string> {
  const id = await createOrder(items)
  await asUser(db, cashier)
  await rpc('public.pay_order($1, $2)', [id, 9_999_999])
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

async function popular() {
  await asUser(db, cashier)
  return (await rpc('public.list_popular_pizzas()')) as unknown as Json[]
}

beforeEach(async () => {
  db = await createTestDb()
  await loadFixture(db)
  await asSuperuser(db)
  const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
  styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  await asUser(db, cashier)
  await rpc('public.open_cash_session($1)', [0])
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('list_popular_pizzas', () => {
  it('returns an empty list when no pizza was sold', async () => {
    expect(await popular()).toEqual([])
  })

  it('ranks paid pizzas by units sold, ignoring notes, and keeps the top 4', async () => {
    const varas = pizza('grande', ['Estilo Varas'])
    const chuys = pizza('grande', ["Estilo Chuy's"])
    const mitades = pizza('grande', ['Estilo Varas', "Estilo Chuy's"])
    const chica = pizza('chica', ['Estilo Varas'])
    const mediana = pizza('mediana', ['Estilo Varas'])
    const first = await sell([line(varas, 2, 'bien cocida'), line(chuys, 1), line(mitades, 3)])
    const second = await sell([line(varas, 1), line(chica, 2)])
    await sell([line(mediana, 1, 'sin cebolla'), line(chuys, 1)])
    await paidDaysAgo(first, 3)
    await paidDaysAgo(second, 2)

    const result = await popular()

    expect(result).toEqual([
      { pizza: await canonical(varas), sold: 3 },
      { pizza: await canonical(mitades), sold: 3 },
      { pizza: await canonical(chuys), sold: 2 },
      { pizza: await canonical(chica), sold: 2 },
    ])
  })

  it('breaks ties by the most recent sale', async () => {
    const varas = pizza('grande', ['Estilo Varas'])
    const chuys = pizza('grande', ["Estilo Chuy's"])
    const older = await sell([line(varas)])
    await sell([line(chuys)])
    await paidDaysAgo(older, 2)

    expect((await popular()).map((p) => p.pizza)).toEqual([await canonical(chuys), await canonical(varas)])
  })

  it('counts only paid orders of the last 30 days', async () => {
    const varas = pizza('grande', ['Estilo Varas'])
    const chuys = pizza('grande', ["Estilo Chuy's"])
    const chica = pizza('chica', ['Estilo Varas'])
    const old = await sell([line(chuys, 5)])
    await paidDaysAgo(old, 31)
    await sell([line(varas)])
    const cancelled = await createOrder([line(chica, 4)])
    await asUser(db, cashier)
    await rpc('public.cancel_order($1)', [cancelled])
    await createOrder([line(chica, 6)])

    expect(await popular()).toEqual([{ pizza: await canonical(varas), sold: 1 }])
  })

  it('merges legacy stored shapes and skips pizzas that are no longer valid', async () => {
    const varas = pizza('grande', ['Estilo Varas'])
    const chuys = pizza('grande', ["Estilo Chuy's"])
    const id = await sell([line(varas, 1), line(chuys, 4)])
    await asSuperuser(db)
    // An older row stored the legacy per-portion extra_cheese flag.
    const legacy = { ...varas, portions: varas.portions.map((p) => ({ ...p, extra_cheese: false })) }
    await db.query(
      `update public.order_items set pizza = $2::jsonb where order_id = $1 and quantity = 1`,
      [id, JSON.stringify(legacy)],
    )
    await sell([line(varas, 1)])
    await asSuperuser(db)
    await db.query(`update public.pizza_styles set active = false where id = $1`, [styleIds["Estilo Chuy's"]])

    expect(await popular()).toEqual([{ pizza: await canonical(varas), sold: 2 }])
  })

  it('is only for signed-in admins and cashiers', async () => {
    await asAnon(db)
    await expect(rpc('public.list_popular_pizzas()')).rejects.toThrow()
    await expect(rpc('public.list_popular_pizzas()')).rejects.toThrow('permission denied')
  })
})

describe('device_list_popular_pizzas', () => {
  it('returns the list to an authorized waiter device and rejects an unknown secret', async () => {
    const varas = pizza('grande', ['Estilo Varas'])
    await sell([line(varas, 2)])
    const admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
    await asUser(db, admin)
    const secret = (await rpc('public.admin_register_device($1)', ['Tablet 1'])).device_secret

    await asAnon(db)
    expect(await rpc('public.device_list_popular_pizzas($1)', [secret])).toEqual([
      { pizza: await canonical(varas), sold: 2 },
    ])
    await asAnon(db)
    await expect(rpc('public.device_list_popular_pizzas($1)', ['nope'])).rejects.toThrow()
  })
})
