// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

let db: TestDb
let cashier: string
let styleIds: Record<string, string>
let jalapenos: string

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
  const orderId = (await rpc('public.create_order($1, $2, $3::jsonb, $4)', [3, null, JSON.stringify(items), null])).order_id
  return rpc('public.quote_order($1)', [orderId])
}

async function setGrandePrice(style: string, cents: number) {
  await asSuperuser(db)
  await db.query(`update public.pizza_style_prices set price_cents = $2 where style_id = $1 and size_code = 'grande'`, [
    styleIds[style],
    cents,
  ])
}

afterEach(async () => {
  await db.close()
})

// Grande seed prices: Estilo Varas 25000, Estilo Chuy's 23000, Estilo Pepperoni 21000.
describe('split pizza average price', () => {
  beforeEach(async () => {
    db = await createTestDb()
    await loadFixture(db)
    await asSuperuser(db)
    const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
    styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
    jalapenos = (await db.query<{ id: string }>(`select id from public.pizza_ingredients where name = 'Jalapeños'`)).rows[0].id
    cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  }, 60_000)

  it('charges the average of the halves, not the most expensive one', async () => {
    const q = await quoteOf({ size: 'grande', portions: [portion('Estilo Varas'), portion("Estilo Chuy's")] })
    expect(q.total_cents).toBe(24000)
    expect(q.lines[0].unit_price_cents).toBe(24000)
  })

  it('averages thirds per portion', async () => {
    const q = await quoteOf({
      size: 'grande',
      portions: [portion('Estilo Varas'), portion("Estilo Chuy's"), portion('Estilo Pepperoni')],
    })
    expect(q.total_cents).toBe(23000)
  })

  it('counts a style repeated in thirds once, like a half', async () => {
    // ⅓ Varas + ⅓ Varas + ⅓ Chuy's = ½ Varas + ½ Chuy's
    const q = await quoteOf({
      size: 'grande',
      portions: [portion('Estilo Varas'), portion('Estilo Varas'), portion("Estilo Chuy's")],
    })
    expect(q.total_cents).toBe(24000)
  })

  it('counts a style repeated in quarters once', async () => {
    // (25000 + 23000 + 21000) / 3 = 23000
    const q = await quoteOf({
      size: 'grande',
      portions: [portion('Estilo Varas'), portion("Estilo Chuy's"), portion('Estilo Pepperoni'), portion('Estilo Pepperoni')],
    })
    expect(q.total_cents).toBe(23000)
  })

  it('rounds an inexact average up to the next $10', async () => {
    await setGrandePrice('Estilo Pepperoni', 22000)
    // (25000 + 23000 + 22000) / 3 = 23333.33
    const q = await quoteOf({
      size: 'grande',
      portions: [portion('Estilo Varas'), portion("Estilo Chuy's"), portion('Estilo Pepperoni'), portion('Estilo Varas')],
    })
    expect(q.total_cents).toBe(24000)
  })

  it('rounds a whole-peso average up to the next $10', async () => {
    await setGrandePrice("Estilo Chuy's", 23200)
    // (25000 + 23200) / 2 = 24100
    const q = await quoteOf({ size: 'grande', portions: [portion('Estilo Varas'), portion("Estilo Chuy's")] })
    expect(q.total_cents).toBe(25000)
  })

  it('charges a split of a single style its exact whole price', async () => {
    await setGrandePrice('Estilo Varas', 24950)
    const q = await quoteOf({
      size: 'grande',
      portions: [portion('Estilo Varas'), portion('Estilo Varas'), portion('Estilo Varas')],
    })
    expect(q.total_cents).toBe(24950)
  })

  it('adds extra ingredients on top of the averaged base', async () => {
    const q = await quoteOf({
      size: 'grande',
      portions: [portion('Estilo Varas', { extra_ingredient_ids: [jalapenos] }), portion("Estilo Chuy's")],
    })
    expect(q.total_cents).toBe(24000 + 500)
  })

  it('keeps a whole pizza at its exact style price, cents included', async () => {
    await setGrandePrice('Estilo Varas', 24950)
    const q = await quoteOf({ size: 'grande', portions: [portion('Estilo Varas')] })
    expect(q.total_cents).toBe(24950)
  })

  it('rounds a split with centavo prices up to the next $10', async () => {
    await setGrandePrice('Estilo Varas', 24950)
    // (24950 + 23000) / 2 = 23975
    const q = await quoteOf({ size: 'grande', portions: [portion('Estilo Varas'), portion("Estilo Chuy's")] })
    expect(q.total_cents).toBe(24000)
  })
})
