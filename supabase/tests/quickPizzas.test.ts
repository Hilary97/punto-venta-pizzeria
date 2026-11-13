// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

let db: TestDb
let styleIds: Record<string, string>
let admin: string
let cashier: string

async function rpc(sql: string, params: unknown[] = []): Promise<any> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

function pizza(size: string, styles: string[]) {
  return { size, portions: styles.map((style) => ({ style_id: styleIds[style], ingredient_ids: [], extra_ingredient_ids: [] })) }
}

async function canonical(config: Json) {
  await asSuperuser(db)
  return rpc('public.validate_pizza($1::jsonb)', [JSON.stringify(config)])
}

async function add(config: Json): Promise<string> {
  await asUser(db, admin)
  return (await rpc('public.admin_add_quick_pizza($1::jsonb)', [JSON.stringify(config)])).id
}

async function adminList(): Promise<Json[]> {
  await asUser(db, admin)
  return rpc('public.admin_list_quick_pizzas()')
}

async function waiterList(): Promise<Json[]> {
  await asUser(db, cashier)
  return rpc('public.list_popular_pizzas()')
}

async function sell(config: Json, quantity: number) {
  await asUser(db, cashier)
  const order = await rpc('public.create_order($1, $2, $3::jsonb, $4)', [
    3,
    null,
    JSON.stringify([{ type: 'pizza', pizza: config, quantity }]),
    null,
  ])
  await rpc('public.pay_order($1, $2)', [order.order_id, 9_999_999])
}

async function quickPickCount() {
  await asSuperuser(db)
  return (await db.query<{ n: number }>(`select count(*)::int as n from public.pizza_quick_picks`)).rows[0].n
}

beforeEach(async () => {
  db = await createTestDb()
  await loadFixture(db)
  await asSuperuser(db)
  const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
  styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
  admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  await asUser(db, cashier)
  await rpc('public.open_cash_session($1)', [0])
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('admin quick pizzas', () => {
  it('stores the canonical pizza and lists them in order', async () => {
    const varas = pizza('grande', ['Estilo Varas'])
    const chuys = pizza('chica', ["Estilo Chuy's"])
    const first = await add({ ...varas, portions: varas.portions.map((p) => ({ ...p, extra_cheese: false })) })
    const second = await add(chuys)

    expect(await adminList()).toEqual([
      { id: first, pizza: await canonical(varas), available: true },
      { id: second, pizza: await canonical(chuys), available: true },
    ])
  })

  it('rejects an invalid pizza, a repeated one and a ninth one without storing anything', async () => {
    await expect(add({ size: 'enorme', portions: [] })).rejects.toThrow('Tamaño de pizza inválido.')
    const varas = pizza('grande', ['Estilo Varas'])
    await add(varas)
    await expect(add(varas)).rejects.toThrow('Esa pizza ya está en la lista.')
    expect(await quickPickCount()).toBe(1)

    const sizes = ['chica', 'mediana', 'grande']
    const styles = ['Estilo Varas', "Estilo Chuy's", 'Estilo Hawaiana']
    const configs = sizes.flatMap((size) => styles.map((style) => pizza(size, [style])))
    for (const config of configs.filter((c) => JSON.stringify(c) !== JSON.stringify(varas)).slice(0, 7)) {
      await add(config)
    }
    expect(await quickPickCount()).toBe(8)
    await expect(add(pizza('grande', ['Estilo Varas', "Estilo Chuy's"]))).rejects.toThrow(
      'Puedes fijar hasta 8 pizzas rápidas.',
    )
    expect(await quickPickCount()).toBe(8)
  })

  it('moves a pizza up or down and removes it', async () => {
    const a = await add(pizza('grande', ['Estilo Varas']))
    const b = await add(pizza('chica', ['Estilo Varas']))
    const c = await add(pizza('mediana', ['Estilo Varas']))
    const ids = async () => (await adminList()).map((row) => row.id)

    await asUser(db, admin)
    await rpc('public.admin_move_quick_pizza($1, $2)', [c, -1])
    expect(await ids()).toEqual([a, c, b])
    await asUser(db, admin)
    await rpc('public.admin_move_quick_pizza($1, $2)', [a, -1])
    expect(await ids()).toEqual([a, c, b])
    await asUser(db, admin)
    await rpc('public.admin_move_quick_pizza($1, $2)', [a, 1])
    expect(await ids()).toEqual([c, a, b])

    await asUser(db, admin)
    await rpc('public.admin_delete_quick_pizza($1)', [a])
    expect(await ids()).toEqual([c, b])
  })

  it('marks a pizza that is no longer valid as unavailable', async () => {
    const id = await add(pizza('grande', ["Estilo Chuy's"]))
    await asSuperuser(db)
    await db.query(`update public.pizza_styles set active = false where id = $1`, [styleIds["Estilo Chuy's"]])

    expect(await adminList()).toEqual([{ id, pizza: expect.any(Object), available: false }])
  })

  it('is only for admins', async () => {
    const id = await add(pizza('grande', ['Estilo Varas']))
    await asUser(db, cashier)
    await expect(rpc('public.admin_add_quick_pizza($1::jsonb)', [JSON.stringify(pizza('chica', ['Estilo Varas']))])).rejects.toThrow(
      'Solo un administrador puede editar las pizzas.',
    )
    await expect(rpc('public.admin_list_quick_pizzas()')).rejects.toThrow('Solo un administrador puede editar las pizzas.')
    await expect(rpc('public.admin_move_quick_pizza($1, $2)', [id, 1])).rejects.toThrow('Solo un administrador puede editar las pizzas.')
    await expect(rpc('public.admin_delete_quick_pizza($1)', [id])).rejects.toThrow('Solo un administrador puede editar las pizzas.')
    await expect(db.query(`select * from public.pizza_quick_picks`)).rejects.toThrow(/permission denied/)
    await asAnon(db)
    await expect(rpc('public.admin_list_quick_pizzas()')).rejects.toThrow(/permission denied/)
    expect(await quickPickCount()).toBe(1)
  })
})

describe('quick pizzas for the waiter', () => {
  it('puts the fixed pizzas first and fills up to 4 with best sellers not already fixed', async () => {
    const varas = pizza('grande', ['Estilo Varas'])
    const chuys = pizza('grande', ["Estilo Chuy's"])
    const chica = pizza('chica', ['Estilo Varas'])
    const mediana = pizza('mediana', ['Estilo Varas'])
    const hawaiana = pizza('grande', ['Estilo Hawaiana'])
    await sell(varas, 9)
    await sell(chuys, 5)
    await sell(chica, 3)
    await sell(mediana, 2)
    await add(hawaiana)
    await add(varas)

    expect((await waiterList()).map((row) => row.pizza)).toEqual([
      await canonical(hawaiana),
      await canonical(varas),
      await canonical(chuys),
      await canonical(chica),
    ])
  })

  it('shows every fixed pizza when there are more than 4 and skips invalid ones', async () => {
    const configs = ['chica', 'mediana', 'grande'].flatMap((size) =>
      ['Estilo Varas', "Estilo Chuy's"].map((style) => pizza(size, [style])),
    )
    for (const config of configs) await add(config)
    await sell(pizza('grande', ['Estilo Hawaiana']), 10)
    await asSuperuser(db)
    await db.query(`update public.pizza_styles set active = false where id = $1`, [styleIds["Estilo Chuy's"]])

    expect((await waiterList()).map((row) => row.pizza)).toEqual([
      await canonical(configs[0]),
      await canonical(configs[2]),
      await canonical(configs[4]),
      await canonical(pizza('grande', ['Estilo Hawaiana'])),
    ])
  })
})
