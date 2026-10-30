// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

let db: TestDb
let cashier: string
let styleIds: Record<string, string>
let jalapenos: string
let other: string
let extraPrice: number

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

let nextTable = 1

async function quoteOf(pizza: Json) {
  await asUser(db, cashier)
  const items = [{ type: 'pizza', quantity: 1, pizza }]
  const orderId = (await rpc('public.create_order($1, $2, $3::jsonb, $4)', [nextTable++, null, JSON.stringify(items), null])).order_id
  return rpc('public.quote_order($1)', [orderId])
}

afterEach(async () => {
  await db.close()
})

describe('double extra ingredient', () => {
  beforeEach(async () => {
    db = await createTestDb()
    await loadFixture(db)
    await asSuperuser(db)
    const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
    styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
    jalapenos = (await db.query<{ id: string }>(`select id from public.pizza_ingredients where name = 'Jalapeños'`)).rows[0].id
    other = (
      await db.query<{ id: string }>(
        `insert into public.pizza_ingredients (name, sort_order) values ('Zanahoria', 999) returning id`,
      )
    ).rows[0].id
    extraPrice = (await db.query<{ c: number }>(`select extra_ingredient_cents as c from public.pizza_settings`)).rows[0].c
    cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  }, 60_000)

  it('keeps a doubled extra ingredient twice in the canonical config, in catalog order', async () => {
    const config = await validate({
      size: 'chica',
      portions: [portion('Estilo Varas', { extra_ingredient_ids: [other, jalapenos, jalapenos] })],
    })
    expect(config.portions[0].extra_ingredient_ids).toEqual([jalapenos, jalapenos, other])
  })

  it('charges a doubled extra ingredient twice and describes it as "Extra <ingrediente>"', async () => {
    const plain = await quoteOf({ size: 'chica', portions: [portion('Estilo Varas')] })
    const single = await quoteOf({ size: 'chica', portions: [portion('Estilo Varas', { extra_ingredient_ids: [jalapenos] })] })
    const double = await quoteOf({
      size: 'chica',
      portions: [portion('Estilo Varas', { extra_ingredient_ids: [jalapenos, jalapenos] })],
    })
    expect(single.total_cents).toBe(plain.total_cents + extraPrice)
    expect(double.total_cents).toBe(plain.total_cents + 2 * extraPrice)
    expect(single.lines[0].name).toBe('Pizza Chica: Estilo Varas + Jalapeños')
    expect(double.lines[0].name).toBe('Pizza Chica: Estilo Varas + Extra Jalapeños')
  })

  it('describes doubled and single extras per portion of a split pizza', async () => {
    const q = await quoteOf({
      size: 'grande',
      portions: [
        portion('Estilo Varas', { extra_ingredient_ids: [other, jalapenos, jalapenos] }),
        portion("Estilo Chuy's", { extra_ingredient_ids: [jalapenos] }),
      ],
    })
    expect(q.lines[0].name).toBe(
      "Pizza Grande · Mitades: ½ Estilo Varas + Extra Jalapeños, Zanahoria | ½ Estilo Chuy's + Jalapeños",
    )
  })

  it('rejects the same extra ingredient three times and keeps included ingredients unique', async () => {
    await expect(
      validate({ size: 'chica', portions: [portion('Estilo Varas', { extra_ingredient_ids: [jalapenos, jalapenos, jalapenos] })] }),
    ).rejects.toThrow('Un ingrediente extra se puede pedir hasta 2 veces por porción.')
    await expect(
      validate({ size: 'chica', portions: [portion('Arma tu combinación', { ingredient_ids: [jalapenos, jalapenos] })] }),
    ).rejects.toThrow('Los ingredientes de una porción no se pueden repetir.')
  })

  it('still rejects an unknown extra ingredient when doubled', async () => {
    const ghost = crypto.randomUUID()
    await expect(
      validate({ size: 'chica', portions: [portion('Estilo Varas', { extra_ingredient_ids: [ghost, ghost] })] }),
    ).rejects.toThrow('Uno de los ingredientes no existe o no está activo.')
  })
})
