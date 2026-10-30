// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

let db: TestDb
let cashier: string
let styleIds: Record<string, string>
let jalapenos: string
let pepperoni: string
let extraPrice: number
let nextTable = 1

async function rpc(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

function portion(style: string, extra: Json = {}) {
  return { style_id: styleIds[style], ingredient_ids: [], extra_ingredient_ids: [], ...extra }
}

async function quoteOf(pizza: Json) {
  await asUser(db, cashier)
  const items = [{ type: 'pizza', quantity: 1, pizza }]
  const orderId = (await rpc('public.create_order($1, $2, $3::jsonb, $4)', [nextTable++, null, JSON.stringify(items), null])).order_id
  return rpc('public.quote_order($1)', [orderId])
}

afterEach(async () => {
  await db.close()
})

describe('double included ingredient', () => {
  beforeEach(async () => {
    nextTable = 1
    db = await createTestDb()
    await loadFixture(db)
    await asSuperuser(db)
    const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
    styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
    const byName = async (name: string) =>
      (await db.query<{ id: string }>(`select id from public.pizza_ingredients where name = $1`, [name])).rows[0].id
    jalapenos = await byName('Jalapeños')
    pepperoni = await byName('Pepperoni')
    extraPrice = (await db.query<{ c: number }>(`select extra_ingredient_cents as c from public.pizza_settings`)).rows[0].c
    cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  }, 60_000)

  it('charges a doubled included ingredient as one extra and describes it inside the included list', async () => {
    const plain = await quoteOf({
      size: 'chica',
      portions: [portion('Arma tu combinación', { ingredient_ids: [jalapenos, pepperoni] })],
    })
    const doubled = await quoteOf({
      size: 'chica',
      portions: [portion('Arma tu combinación', { ingredient_ids: [jalapenos, pepperoni], extra_ingredient_ids: [jalapenos] })],
    })
    expect(doubled.total_cents).toBe(plain.total_cents + extraPrice)
    expect(plain.lines[0].name).toMatch(/^Pizza Chica: Arma tu combinación \((Jalapeños, Pepperoni|Pepperoni, Jalapeños)\)$/)
    expect(doubled.lines[0].name).toBe(plain.lines[0].name.replace('Jalapeños', 'Extra Jalapeños'))
  })

  it('lists the remaining extra occurrences after the included list', async () => {
    const q = await quoteOf({
      size: 'chica',
      portions: [portion('Arma tu combinación', { ingredient_ids: [jalapenos], extra_ingredient_ids: [jalapenos, jalapenos] })],
    })
    expect(q.lines[0].name).toBe('Pizza Chica: Arma tu combinación (Extra Jalapeños) + Jalapeños')
  })

  it('keeps describing extras of other ingredients as before', async () => {
    const q = await quoteOf({
      size: 'chica',
      portions: [portion('Arma tu combinación', { ingredient_ids: [pepperoni], extra_ingredient_ids: [jalapenos, jalapenos] })],
    })
    expect(q.lines[0].name).toBe('Pizza Chica: Arma tu combinación (Pepperoni) + Extra Jalapeños')
  })
})
