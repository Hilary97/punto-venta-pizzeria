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

async function saveStyle(args: { id?: string | null; name: string; kind?: string; included?: number; fixed?: number | null }) {
  await asUser(db, admin)
  const res = await db.query<{ r: Json }>(
    `select public.admin_save_pizza_style($1, $2, '', $3, $4, 30, true, $5::jsonb, $6) as r`,
    [args.id ?? null, args.name, args.kind ?? 'special', args.included ?? 2, JSON.stringify(PRICES), args.fixed ?? null],
  )
  return res.rows[0].r.style_id as string
}

async function fixedIngredients(): Promise<Record<string, number>> {
  await asSuperuser(db)
  const res = await db.query<{ name: string; fixed_ingredients: number }>(
    `select name, fixed_ingredients from public.pizza_styles`,
  )
  return Object.fromEntries(res.rows.map((r) => [r.name, r.fixed_ingredients]))
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
describe('elaboration fee exception for styles of two or fewer ingredients', () => {
  beforeEach(async () => {
    db = await createTestDb()
    await loadFixture(db)
    await loadStyles()
    const ingredients = await db.query<{ id: string }>(`select id from public.pizza_ingredients order by sort_order limit 3`)
    ingredientIds = ingredients.rows.map((r) => r.id)
    cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
    admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  }, 60_000)

  it('seeds the fixed ingredients of every style', async () => {
    const fixed = await fixedIngredients()
    expect(fixed['Estilo Hawaiana']).toBe(2)
    expect(fixed['Estilo Italiana']).toBe(2)
    expect(fixed['Estilo Pepperoni']).toBe(1)
    expect(fixed['Estilo Varas']).toBe(7)
    expect(fixed['Estilo Vegetariana']).toBeGreaterThan(2)
    expect(fixed['Arma tu combinación']).toBe(0)
  })

  it('charges no fee for halves of styles with two or fewer ingredients', async () => {
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Hawaiana'), portion('Estilo Pepperoni')] })).toBe(21000)
  })

  it('charges no fee for thirds of styles with two or fewer ingredients', async () => {
    const portions = [portion('Estilo Hawaiana'), portion('Estilo Italiana'), portion('Estilo Pepperoni')]
    expect(await totalOf({ size: 'grande', portions })).toBe(21000)
  })

  it('charges no fee for quarters of styles with two or fewer ingredients', async () => {
    const portions = [
      portion('Estilo Hawaiana'),
      portion('Estilo Italiana'),
      portion('Estilo Pepperoni'),
      portion('Arma tu combinación', { ingredient_ids: ingredientIds.slice(0, 2) }),
    ]
    expect(await totalOf({ size: 'grande', portions })).toBe(21000)
  })

  it('charges no fee for Arma tu combinación with two chosen ingredients', async () => {
    const portions = [
      portion('Arma tu combinación', { ingredient_ids: ingredientIds.slice(0, 2) }),
      portion('Estilo Hawaiana'),
    ]
    expect(await totalOf({ size: 'grande', portions })).toBe(21000)
  })

  it('keeps the fee when any style has more than two ingredients', async () => {
    // (21000 + 25000) / 2 = 23000, + $10 halves fee
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Hawaiana'), portion('Estilo Varas')] })).toBe(24000)
  })

  it('does not count paid extra ingredients against the style', async () => {
    const portions = [portion('Estilo Hawaiana', { extra_ingredient_ids: [ingredientIds[0]] }), portion('Estilo Pepperoni')]
    // 21000 average, no fee, + $5 extra ingredient
    expect(await totalOf({ size: 'grande', portions })).toBe(21500)
  })

  it('counts the chosen ingredients of a custom style that includes more than two', async () => {
    const custom = await saveStyle({ name: 'Arma tu triple', kind: 'custom', included: 3 })
    await loadStyles()
    expect(custom).toBe(styleIds['Arma tu triple'])
    const three = [portion('Arma tu triple', { ingredient_ids: ingredientIds }), portion('Estilo Pepperoni')]
    expect(await totalOf({ size: 'grande', portions: three })).toBe(22000)
    const two = [portion('Arma tu triple', { ingredient_ids: ingredientIds.slice(0, 2) }), portion('Estilo Pepperoni')]
    expect(await totalOf({ size: 'grande', portions: two })).toBe(21000)
  })

  it('lets the admin change the fixed ingredients of a style', async () => {
    await saveStyle({ id: styleIds['Estilo Pepperoni'], name: 'Estilo Pepperoni', fixed: 3 })
    expect((await fixedIngredients())['Estilo Pepperoni']).toBe(3)
    // (21000 + 21000) / 2 = 21000, + $10 halves fee
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Hawaiana'), portion('Estilo Pepperoni')] })).toBe(22000)
  })

  it('keeps the fixed ingredients when the admin saves without them', async () => {
    await saveStyle({ id: styleIds['Estilo Hawaiana'], name: 'Estilo Hawaiana', fixed: null })
    expect((await fixedIngredients())['Estilo Hawaiana']).toBe(2)
  })

  it('stores zero fixed ingredients for a custom style', async () => {
    await saveStyle({ name: 'Arma la tuya', kind: 'custom', included: 2, fixed: 5 })
    expect((await fixedIngredients())['Arma la tuya']).toBe(0)
  })

  it.each([-1, 21])('rejects %s fixed ingredients without changing anything', async (fixed) => {
    const before = await fixedIngredients()
    await expect(saveStyle({ id: styleIds['Estilo Hawaiana'], name: 'Estilo Hawaiana', fixed })).rejects.toThrow(
      'Los ingredientes fijos deben estar entre 0 y 20.',
    )
    expect(await fixedIngredients()).toEqual(before)
  })

  it('requires the fixed ingredients for a new special style', async () => {
    const before = await fixedIngredients()
    await expect(saveStyle({ name: 'Estilo Nuevo', fixed: null })).rejects.toThrow(
      'Los ingredientes fijos deben estar entre 0 y 20.',
    )
    expect(await fixedIngredients()).toEqual(before)
  })
})
