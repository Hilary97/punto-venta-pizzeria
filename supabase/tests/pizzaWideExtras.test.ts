// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

const CHEESE_ID = '00000000-0000-4000-8000-000000000001'

type Json = Record<string, any>

let db: TestDb
let cashier: string
let styleIds: Record<string, string>
let jalapenos: string
let orilla: string

async function rpc(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

function portion(style: string, extra: Json = {}) {
  return { style_id: styleIds[style], ingredient_ids: [], extra_ingredient_ids: [], ...extra }
}

async function validate(config: unknown) {
  await asSuperuser(db)
  return rpc('public.validate_pizza($1::jsonb)', [JSON.stringify(config)])
}

async function quoteOf(pizza: Json) {
  await asUser(db, cashier)
  const items = [{ type: 'pizza', quantity: 1, pizza }]
  const orderId = (await rpc('public.create_order($1, $2, $3::jsonb, $4)', [3, null, JSON.stringify(items), null])).order_id
  return rpc('public.quote_order($1)', [orderId])
}

afterEach(async () => {
  await db.close()
})

describe('pizza-wide extras', () => {
  beforeEach(async () => {
    db = await createTestDb()
    await loadFixture(db)
    await asSuperuser(db)
    const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
    styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
    jalapenos = (await db.query<{ id: string }>(`select id from public.pizza_ingredients where name = 'Jalapeños'`)).rows[0].id
    orilla = (
      await db.query<{ id: string }>(
        `insert into public.pizza_extras (name, price_cents, sort_order) values ('Orilla rellena', 4000, 2) returning id`,
      )
    ).rows[0].id
    cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  }, 60_000)

  it('keeps extras on the pizza, in catalog order, and none on the portions', async () => {
    const config = await validate({
      size: 'grande',
      portions: [portion('Estilo Varas'), portion("Estilo Chuy's")],
      extra_ids: [orilla, CHEESE_ID],
    })
    expect(config).toEqual({
      size: 'grande',
      portions: [
        { style_id: styleIds['Estilo Varas'], ingredient_ids: [], extra_ingredient_ids: [] },
        { style_id: styleIds["Estilo Chuy's"], ingredient_ids: [], extra_ingredient_ids: [] },
      ],
      extra_ids: [CHEESE_ID, orilla],
    })
  })

  it('moves legacy per-portion extras and extra_cheese to the pizza without repeating them', async () => {
    const config = await validate({
      size: 'grande',
      portions: [portion('Estilo Varas', { extra_ids: [orilla, CHEESE_ID] }), portion("Estilo Chuy's", { extra_cheese: true, extra_ids: [orilla] })],
    })
    expect(config.extra_ids).toEqual([CHEESE_ID, orilla])
    expect(config.portions.every((p: Json) => !('extra_ids' in p) && !('extra_cheese' in p))).toBe(true)
  })

  it('charges each extra once for the whole pizza and lists it after the portions', async () => {
    const q = await quoteOf({
      size: 'grande',
      portions: [portion('Estilo Varas', { extra_ingredient_ids: [jalapenos] }), portion("Estilo Chuy's")],
      extra_ids: [orilla, CHEESE_ID],
    })
    // 24000 average of the halves + 1000 halves fee + 500 jalapeños (per portion) + 3000 queso + 4000 orilla (once each)
    expect(q.total_cents).toBe(32500)
    expect(q.lines[0].name).toBe(
      "Pizza Grande · Mitades: ½ Estilo Varas + Jalapeños | ½ Estilo Chuy's · Extras: Extra queso, Orilla rellena",
    )
  })

  it('charges a legacy extra repeated on several portions only once', async () => {
    const q = await quoteOf({
      size: 'grande',
      portions: [portion('Estilo Varas', { extra_ids: [orilla] }), portion("Estilo Chuy's", { extra_ids: [orilla] })],
    })
    expect(q.total_cents).toBe(29000)
  })

  it('describes a whole pizza with its extras as before', async () => {
    const q = await quoteOf({ size: 'chica', portions: [portion('Estilo Varas')], extra_ids: [CHEESE_ID] })
    expect(q.lines[0].name).toBe('Pizza Chica: Estilo Varas + Extra queso')
  })

  it('accepts any number of extra ingredients and charges each one', async () => {
    await asSuperuser(db)
    const inserted = await db.query<{ id: string }>(
      `insert into public.pizza_ingredients (name, sort_order)
       select 'Extra ' || n, 100 + n from generate_series(1, 12) as n returning id`,
    )
    const ids = inserted.rows.map((r) => r.id)
    const price = (await db.query<{ c: number }>(`select extra_ingredient_cents as c from public.pizza_settings`)).rows[0].c

    const priceOf = async (config: Json) =>
      (await db.query<{ p: number }>(`select public.price_pizza(public.validate_pizza($1::jsonb)) as p`, [JSON.stringify(config)]))
        .rows[0].p
    const plain = await priceOf({ size: 'chica', portions: [portion('Estilo Varas')] })
    const loaded = await priceOf({ size: 'chica', portions: [portion('Estilo Varas', { extra_ingredient_ids: ids })] })
    expect(loaded).toBe(plain + 12 * price)
  })

  it('rejects a repeated, unknown or malformed pizza extra', async () => {
    const chica = { size: 'chica', portions: [portion('Estilo Varas')] }
    await expect(validate({ ...chica, extra_ids: [orilla, orilla] })).rejects.toThrow(
      'Los extras de la pizza no se pueden repetir.',
    )
    await expect(validate({ ...chica, extra_ids: [crypto.randomUUID()] })).rejects.toThrow(
      'Uno de los extras no existe o no está activo.',
    )
    await expect(validate({ ...chica, extra_ids: 'x' })).rejects.toThrow('La configuración de la pizza es inválida.')
    await expect(validate({ ...chica, extra_ids: ['nope'] })).rejects.toThrow('La configuración de la pizza es inválida.')
  })
})
