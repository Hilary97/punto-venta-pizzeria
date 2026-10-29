// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

let db: TestDb
let cashier: string
let admin: string
let styleIds: Record<string, string>
let ingredientIds: string[]
let table = 0

const PRICES = { chica: 11000, mediana: 19000, grande: 21000 }

async function rpc(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

function portion(style: string, extra: Json = {}) {
  return { style_id: styleIds[style], ingredient_ids: [], extra_ingredient_ids: [], ...extra }
}

async function totalOf(pizza: Json): Promise<number> {
  await asUser(db, cashier)
  const items = [{ type: 'pizza', quantity: 1, pizza }]
  const orderId = (await rpc('public.create_order($1, $2, $3::jsonb, $4)', [++table, null, JSON.stringify(items), null])).order_id
  return (await rpc('public.quote_order($1)', [orderId])).total_cents
}

async function saveStyle(args: { id?: string | null; name: string; kind?: string; included?: number; charges?: boolean | null; as?: string }) {
  await asUser(db, args.as ?? admin)
  const res = await db.query<{ r: Json }>(
    `select public.admin_save_pizza_style($1, $2, '', $3, $4, 30, true, $5::jsonb, $6) as r`,
    [args.id ?? null, args.name, args.kind ?? 'special', args.included ?? 2, JSON.stringify(PRICES), args.charges ?? null],
  )
  return res.rows[0].r.style_id as string
}

async function chargesElaboration(): Promise<Record<string, boolean>> {
  await asSuperuser(db)
  const res = await db.query<{ name: string; charges_elaboration: boolean }>(
    `select name, charges_elaboration from public.pizza_styles`,
  )
  return Object.fromEntries(res.rows.map((r) => [r.name, r.charges_elaboration]))
}

async function loadStyles() {
  await asSuperuser(db)
  const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
  styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
}

afterEach(async () => {
  await db.close()
})

// Grande seed prices: Hawaiana, Italiana, Pepperoni and Arma tu combinación 21000; Varas 25000.
describe('elaboration fee charged only for styles the admin marks', () => {
  beforeEach(async () => {
    table = 0
    db = await createTestDb()
    await loadFixture(db)
    await loadStyles()
    const ingredients = await db.query<{ id: string }>(`select id from public.pizza_ingredients order by sort_order limit 3`)
    ingredientIds = ingredients.rows.map((r) => r.id)
    cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
    admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  }, 60_000)

  it('marks the styles that pay the fee today', async () => {
    const charges = await chargesElaboration()
    expect(charges['Estilo Hawaiana']).toBe(false)
    expect(charges['Estilo Italiana']).toBe(false)
    expect(charges['Estilo Pepperoni']).toBe(false)
    expect(charges['Estilo Varas']).toBe(true)
    expect(charges['Estilo Vegetariana']).toBe(true)
    expect(charges['Arma tu combinación']).toBe(false)
  })

  it('charges no fee for halves, thirds or quarters of unmarked styles', async () => {
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Hawaiana'), portion('Estilo Pepperoni')] })).toBe(21000)
    const thirds = [portion('Estilo Hawaiana'), portion('Estilo Italiana'), portion('Estilo Pepperoni')]
    expect(await totalOf({ size: 'grande', portions: thirds })).toBe(21000)
    const quarters = [...thirds, portion('Arma tu combinación', { ingredient_ids: ingredientIds.slice(0, 2) })]
    expect(await totalOf({ size: 'grande', portions: quarters })).toBe(21000)
  })

  it('charges the split fee when any portion is a marked style', async () => {
    // (21000 + 25000) / 2 = 23000, + $10 halves fee
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Hawaiana'), portion('Estilo Varas')] })).toBe(24000)
    // same average, + $20 thirds fee
    const thirds = [portion('Estilo Hawaiana'), portion('Estilo Pepperoni'), portion('Estilo Varas')]
    expect(await totalOf({ size: 'grande', portions: thirds })).toBe(25000)
  })

  it('charges no fee for a whole or single-style pizza of a marked style', async () => {
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Varas')] })).toBe(25000)
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Varas'), portion('Estilo Varas')] })).toBe(25000)
  })

  it('does not count paid extra ingredients', async () => {
    const portions = [portion('Estilo Hawaiana', { extra_ingredient_ids: ingredientIds }), portion('Estilo Pepperoni')]
    // 21000 average, no fee, + 3 x $5 extra ingredients
    expect(await totalOf({ size: 'grande', portions })).toBe(22500)
  })

  it('uses the mark of a custom style, not the chosen ingredients', async () => {
    await saveStyle({ name: 'Arma tu triple', kind: 'custom', included: 3, charges: true })
    await loadStyles()
    const two = [portion('Arma tu triple', { ingredient_ids: ingredientIds.slice(0, 2) }), portion('Estilo Pepperoni')]
    expect(await totalOf({ size: 'grande', portions: two })).toBe(22000)
    const three = [portion('Arma tu combinación', { ingredient_ids: ingredientIds.slice(0, 2) }), portion('Estilo Pepperoni')]
    expect(await totalOf({ size: 'grande', portions: three })).toBe(21000)
  })

  it('lets the admin mark and unmark a style', async () => {
    await saveStyle({ id: styleIds['Estilo Pepperoni'], name: 'Estilo Pepperoni', charges: true })
    await saveStyle({ id: styleIds['Estilo Varas'], name: 'Estilo Varas', charges: false })
    const charges = await chargesElaboration()
    expect(charges['Estilo Pepperoni']).toBe(true)
    expect(charges['Estilo Varas']).toBe(false)
    // (21000 + 21000) / 2 = 21000, + $10 halves fee
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Hawaiana'), portion('Estilo Pepperoni')] })).toBe(22000)
    // (21000 + 21000) / 2 = 21000 (Varas saved at the test prices), no fee
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Hawaiana'), portion('Estilo Varas')] })).toBe(21000)
  })

  it('keeps the mark when the admin saves without it', async () => {
    await saveStyle({ id: styleIds['Estilo Varas'], name: 'Estilo Varas', charges: null })
    expect((await chargesElaboration())['Estilo Varas']).toBe(true)
  })

  it('marks a new style unless the admin says otherwise', async () => {
    await saveStyle({ name: 'Estilo Nuevo', charges: null })
    await saveStyle({ name: 'Estilo Simple', charges: false })
    const charges = await chargesElaboration()
    expect(charges['Estilo Nuevo']).toBe(true)
    expect(charges['Estilo Simple']).toBe(false)
  })

  it('rejects a cashier changing the mark without changing anything', async () => {
    const before = await chargesElaboration()
    await expect(
      saveStyle({ id: styleIds['Estilo Hawaiana'], name: 'Estilo Hawaiana', charges: true, as: cashier }),
    ).rejects.toThrow('Solo un administrador puede editar las pizzas.')
    expect(await chargesElaboration()).toEqual(before)
  })
})
