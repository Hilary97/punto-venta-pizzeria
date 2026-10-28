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
    await setGrandePrice('Estilo Varas', 34000)
    // (34000 + 23000) / 2 = 28500 -> 29000, + $10 halves fee
    const q = await quoteOf({ size: 'grande', portions: [portion('Estilo Varas'), portion("Estilo Chuy's")] })
    expect(q.total_cents).toBe(30000)
    expect(q.lines[0].unit_price_cents).toBe(30000)
  })

  it('averages thirds per distinct style', async () => {
    const q = await quoteOf({
      size: 'grande',
      portions: [portion('Estilo Varas'), portion("Estilo Chuy's"), portion('Estilo Pepperoni')],
    })
    // (25000 + 23000 + 21000) / 3 = 23000, + $20 thirds fee
    expect(q.total_cents).toBe(25000)
  })

  it('counts a style repeated in thirds once in the average but charges the thirds fee', async () => {
    await setGrandePrice('Estilo Varas', 34000)
    // ⅓ Varas + ⅓ Varas + ⅓ Chuy's: (34000 + 23000) / 2 = 28500 -> 29000, + $20 thirds fee
    const q = await quoteOf({
      size: 'grande',
      portions: [portion('Estilo Varas'), portion('Estilo Varas'), portion("Estilo Chuy's")],
    })
    expect(q.total_cents).toBe(31000)
  })

  it('counts a style repeated in quarters once in the average', async () => {
    await setGrandePrice('Estilo Pepperoni', 6000)
    // (25000 + 23000 + 6000) / 3 = 18000, not (25000 + 23000 + 6000 + 6000) / 4 = 15000; + $30 quarters fee
    const q = await quoteOf({
      size: 'grande',
      portions: [portion('Estilo Varas'), portion("Estilo Chuy's"), portion('Estilo Pepperoni'), portion('Estilo Pepperoni')],
    })
    expect(q.total_cents).toBe(21000)
  })

  it.each([
    ['halves', 2, 25000],
    ['thirds', 3, 26000],
    ['quarters', 4, 27000],
  ])('adds the %s elaboration fee to the averaged base', async (_name, count, total) => {
    // Varas 25000 and Chuy's 23000 average 24000 however they are split; fee is $10 per extra portion
    const styles = ['Estilo Varas', "Estilo Chuy's"]
    const portions = Array.from({ length: count as number }, (_, i) => portion(styles[i % 2]))
    const q = await quoteOf({ size: 'grande', portions })
    expect(q.total_cents).toBe(total)
  })

  it('rounds an inexact average up to the next $10', async () => {
    await setGrandePrice('Estilo Pepperoni', 22000)
    // (25000 + 23000 + 22000) / 3 = 23333.33 -> 24000, + $30 quarters fee
    const q = await quoteOf({
      size: 'grande',
      portions: [portion('Estilo Varas'), portion("Estilo Chuy's"), portion('Estilo Pepperoni'), portion('Estilo Varas')],
    })
    expect(q.total_cents).toBe(27000)
  })

  it('rounds a whole-peso average up to the next $10', async () => {
    await setGrandePrice("Estilo Chuy's", 23200)
    // (25000 + 23200) / 2 = 24100 -> 25000, + $10 halves fee
    const q = await quoteOf({ size: 'grande', portions: [portion('Estilo Varas'), portion("Estilo Chuy's")] })
    expect(q.total_cents).toBe(26000)
  })

  it('does not add $10 to an average that is already a multiple of $10', async () => {
    // (25000 + 23000 + 21000) / 3 = 23000 stays 23000, + $20 thirds fee
    const q = await quoteOf({
      size: 'grande',
      portions: [portion('Estilo Varas'), portion("Estilo Chuy's"), portion('Estilo Pepperoni')],
    })
    expect(q.total_cents).toBe(25000)
  })

  it('rounds up in $10 steps, not $25', async () => {
    await setGrandePrice("Estilo Chuy's", 26000)
    // (25000 + 26000) / 2 = 25500 -> 26000, + $10 halves fee
    const q = await quoteOf({ size: 'grande', portions: [portion('Estilo Varas'), portion("Estilo Chuy's")] })
    expect(q.total_cents).toBe(27000)
  })

  it('charges a split of a single style its exact whole price, with no elaboration fee', async () => {
    await setGrandePrice('Estilo Varas', 24950)
    const q = await quoteOf({
      size: 'grande',
      portions: [portion('Estilo Varas'), portion('Estilo Varas'), portion('Estilo Varas')],
    })
    expect(q.total_cents).toBe(24950)
  })

  it('adds extra ingredients on top of the averaged base and fee', async () => {
    const q = await quoteOf({
      size: 'grande',
      portions: [portion('Estilo Varas', { extra_ingredient_ids: [jalapenos] }), portion("Estilo Chuy's")],
    })
    // (25000 + 23000) / 2 = 24000, + $10 halves fee, + $5 jalapeños
    expect(q.total_cents).toBe(24000 + 1000 + 500)
  })

  it('keeps a whole pizza at its exact style price, cents included', async () => {
    await setGrandePrice('Estilo Varas', 24950)
    const q = await quoteOf({ size: 'grande', portions: [portion('Estilo Varas')] })
    expect(q.total_cents).toBe(24950)
  })

  it('rounds a split with centavo prices up to the next $10', async () => {
    await setGrandePrice('Estilo Varas', 24950)
    // (24950 + 23000) / 2 = 23975 -> 24000, + $10 halves fee
    const q = await quoteOf({ size: 'grande', portions: [portion('Estilo Varas'), portion("Estilo Chuy's")] })
    expect(q.total_cents).toBe(25000)
  })
})
