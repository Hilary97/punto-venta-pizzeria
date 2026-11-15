// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

const TOO_LONG = 'La nota de cada porción admite hasta 80 caracteres.'

let db: TestDb
let cashier: string
let admin: string
let styleIds: Record<string, string>
let nextTable = 1

async function rpc(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

function portion(style: string, extra: Json = {}) {
  return { style_id: styleIds[style], ingredient_ids: [], extra_ingredient_ids: [], ...extra }
}

function halves(a: Json, b: Json = {}, size = 'grande') {
  return { size, portions: [portion('Estilo Varas', a), portion("Estilo Chuy's", b)] }
}

async function validated(config: Json) {
  await asSuperuser(db)
  return rpc('public.validate_pizza($1::jsonb)', [JSON.stringify(config)])
}

async function createOrder(pizza: Json, quantity = 1): Promise<string> {
  await asUser(db, cashier)
  const items = [{ type: 'pizza', quantity, pizza, notes: null }]
  return (await rpc('public.create_order($1, $2, $3::jsonb, $4)', [nextTable++, null, JSON.stringify(items), null])).order_id
}

async function quoteOf(pizza: Json) {
  const id = await createOrder(pizza)
  return rpc('public.quote_order($1)', [id])
}

async function sell(pizza: Json, quantity = 1) {
  const id = await createOrder(pizza, quantity)
  await asUser(db, cashier)
  await rpc('public.pay_order($1, $2)', [id, 99_999_999])
  return id
}

async function count(table: string): Promise<number> {
  await asSuperuser(db)
  return Number((await db.query<{ n: string }>(`select count(*) as n from public.${table}`)).rows[0].n)
}

beforeEach(async () => {
  nextTable = 1
  db = await createTestDb()
  await loadFixture(db)
  await asSuperuser(db)
  const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
  styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  await asUser(db, cashier)
  await rpc('public.open_cash_session($1)', [0])
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('portion notes in validate_pizza (S2)', () => {
  it('keeps a note trimmed on its portion', async () => {
    const config = await validated(halves({ note: '  sin piña en la orilla \n' }, { note: 'bien cocida' }))
    expect(config.portions.map((p: Json) => p.note)).toEqual(['sin piña en la orilla', 'bien cocida'])
  })

  it('drops a blank or missing note', async () => {
    const config = await validated(halves({ note: '   ' }, { note: null }))
    for (const p of config.portions) expect(Object.keys(p)).not.toContain('note')
    expect(config).toEqual(await validated(halves({}, {})))
  })

  it('accepts exactly 80 characters', async () => {
    const note = 'á'.repeat(80)
    const config = await validated(halves({ note }))
    expect(config.portions[0].note).toBe(note)
  })

  it('accepts 80 characters once trimmed', async () => {
    const config = await validated(halves({ note: ` ${'a'.repeat(80)} ` }))
    expect(config.portions[0].note).toBe('a'.repeat(80))
  })

  it('rejects 81 characters with a clear message and stores nothing', async () => {
    await expect(validated(halves({}, { note: 'a'.repeat(81) }))).rejects.toThrow(TOO_LONG)
    const before = await count('order_items')
    await expect(createOrder(halves({ note: 'a'.repeat(81) }))).rejects.toThrow(TOO_LONG)
    expect(await count('order_items')).toBe(before)
    expect(await count('orders')).toBe(0)
  })

  it('rejects a note that is not text', async () => {
    await expect(validated(halves({ note: 5 }))).rejects.toThrow('La configuración de la pizza es inválida.')
  })

  it('keeps validating pizzas stored without notes', async () => {
    const config = await validated(halves({}, {}))
    expect(config.portions).toEqual([
      { style_id: styleIds['Estilo Varas'], ingredient_ids: [], extra_ingredient_ids: [] },
      { style_id: styleIds["Estilo Chuy's"], ingredient_ids: [], extra_ingredient_ids: [] },
    ])
  })

  it('does not change the price', async () => {
    const plain = await quoteOf(halves({}, {}))
    const noted = await quoteOf(halves({ note: 'sin piña' }, { note: 'bien cocida' }))
    expect(noted.total_cents).toBe(plain.total_cents)
    expect(noted.lines[0].unit_price_cents ?? noted.lines[0].total_cents).toBe(plain.lines[0].unit_price_cents ?? plain.lines[0].total_cents)
  })
})

describe('portion notes in descriptions and kitchen lines (S3)', () => {
  it('describes each note right after its portion', async () => {
    const config = await validated(halves({ note: 'sin piña en la orilla' }, {}))
    expect(await rpc('public.describe_pizza($1::jsonb)', [JSON.stringify(config)])).toBe(
      "Pizza Grande · Mitades: ½ Estilo Varas — sin piña en la orilla | ½ Estilo Chuy's",
    )
  })

  it('keeps a "|" of the note from reading as a portion separator', async () => {
    const config = await validated(halves({ note: 'a | b' }, {}))
    expect(await rpc('public.describe_pizza($1::jsonb)', [JSON.stringify(config)])).toBe(
      "Pizza Grande · Mitades: ½ Estilo Varas — a / b | ½ Estilo Chuy's",
    )
  })

  it('names the stored line with the notes and carries them in the kitchen line', async () => {
    const id = await createOrder(halves({ note: 'sin piña' }, { note: 'bien cocida' }))
    await asSuperuser(db)
    const line = (await db.query<{ r: Json }>(`select public.kitchen_line_json(i) as r from public.order_items i where i.order_id = $1`, [id])).rows[0].r
    expect(line.product_name).toBe("Pizza Grande · Mitades: ½ Estilo Varas — sin piña | ½ Estilo Chuy's — bien cocida")
    expect(line.pizza.portions.map((p: Json) => p.note)).toEqual(['sin piña', 'bien cocida'])
  })

  it('leaves the description of a pizza without notes as before', async () => {
    const q = await quoteOf(halves({}, {}))
    expect(q.lines[0].name).toBe("Pizza Grande · Mitades: ½ Estilo Varas | ½ Estilo Chuy's")
  })
})

describe('portion notes and Más vendidas (S4)', () => {
  it('groups pizzas that differ only by portion notes and returns the config without them', async () => {
    await sell(halves({ note: 'sin piña' }), 2)
    await sell(halves({ note: 'bien cocida' }, { note: 'poca salsa' }), 1)
    await sell(halves({}, {}), 1)
    await asUser(db, cashier)
    const picks = (await rpc('public.list_popular_picks()')) as unknown as Json[]
    const expected = await validated(halves({}, {}))
    expect(picks).toEqual([{ kind: 'pizza', pizza: expected, sold: 4 }])
    expect(JSON.stringify(picks)).not.toContain('"note"')
  })

  it('also strips them in the older popular_pizzas ranking', async () => {
    await sell(halves({ note: 'sin piña' }), 1)
    await sell(halves({ note: 'otra' }), 1)
    await asSuperuser(db)
    const list = (await rpc('public.popular_pizzas(4)')) as unknown as Json[]
    expect(list).toEqual([{ pizza: await validated(halves({}, {})), sold: 2 }])
  })

  it('stores and returns fixed quick pizzas without portion notes', async () => {
    await asUser(db, admin)
    await rpc('public.admin_add_quick_pizza($1::jsonb)', [JSON.stringify(halves({ note: 'sin piña' }, { note: 'bien cocida' }))])
    const plain = await validated(halves({}, {}))

    await asSuperuser(db)
    const stored = await db.query<{ pizza: Json }>(`select pizza from public.pizza_quick_picks`)
    expect(stored.rows.map((r) => r.pizza)).toEqual([plain])

    await asUser(db, admin)
    const list = (await rpc('public.admin_list_quick_pizzas()')) as unknown as Json[]
    expect(list.map((r) => r.pizza)).toEqual([plain])

    await asUser(db, cashier)
    const picks = (await rpc('public.list_popular_picks()')) as unknown as Json[]
    expect(picks).toEqual([{ kind: 'pizza', pizza: plain, sold: null }])

    await asUser(db, admin)
    await expect(rpc('public.admin_add_quick_pizza($1::jsonb)', [JSON.stringify(halves({ note: 'otra' }))])).rejects.toThrow(
      'Esa pizza ya está en la lista.',
    )
  })

  it('does not list a sold pizza again when its notes-free version is a fixed quick pizza', async () => {
    await asUser(db, admin)
    await rpc('public.admin_add_quick_pizza($1::jsonb)', [JSON.stringify(halves({}, {}))])
    await sell(halves({ note: 'sin piña' }))
    await asUser(db, cashier)
    const picks = (await rpc('public.list_popular_picks()')) as unknown as Json[]
    expect(picks).toHaveLength(1)
    expect(picks[0].sold).toBeNull()
  })
})
