// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { applyMigration, asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>
type Fees = { halves: number; thirds: number; quarters: number }

const MIGRATION = '20261118120000_pizza_style_split_fees.sql'
const PRICES = { chica: 11000, mediana: 19000, grande: 21000 }

let db: TestDb
let cashier: string
let admin: string
let styleIds: Record<string, string>
let ingredientIds: string[]
let table = 0

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

async function loadStyles() {
  await asSuperuser(db)
  const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
  styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
}

async function feesByStyle(): Promise<Record<string, Fees>> {
  await asSuperuser(db)
  const res = await db.query<{ name: string } & Fees>(
    `select name, split_halves_fee_cents as halves, split_thirds_fee_cents as thirds,
            split_quarters_fee_cents as quarters
     from public.pizza_styles`,
  )
  return Object.fromEntries(res.rows.map(({ name, ...fees }) => [name, fees]))
}

async function setFees(style: string, fees: Fees, charges = true) {
  await asSuperuser(db)
  await db.query(
    `update public.pizza_styles
     set split_halves_fee_cents = $2, split_thirds_fee_cents = $3, split_quarters_fee_cents = $4,
         charges_elaboration = $5
     where id = $1`,
    [styleIds[style], fees.halves, fees.thirds, fees.quarters, charges],
  )
}

async function marks(): Promise<Record<string, boolean>> {
  await asSuperuser(db)
  const res = await db.query<{ name: string; charges_elaboration: boolean }>(
    `select name, charges_elaboration from public.pizza_styles`,
  )
  return Object.fromEntries(res.rows.map((r) => [r.name, r.charges_elaboration]))
}

async function saveStyle(args: { id?: string | null; name: string; fees?: unknown; charges?: boolean; as?: string }) {
  await asUser(db, args.as ?? admin)
  const res = await db.query<{ r: Json }>(
    `select public.admin_save_pizza_style($1, $2, '', 'special', 2, 30, true, $3::jsonb, $4::jsonb, $5) as r`,
    [
      args.id ?? null,
      args.name,
      JSON.stringify(PRICES),
      args.fees === undefined ? null : JSON.stringify(args.fees),
      args.charges ?? null,
    ],
  )
  return res.rows[0].r.style_id as string
}

async function setup() {
  table = 0
  await loadFixture(db)
  await loadStyles()
  const ingredients = await db.query<{ id: string }>(`select id from public.pizza_ingredients order by sort_order limit 3`)
  ingredientIds = ingredients.rows.map((r) => r.id)
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
}

afterEach(async () => {
  await db.close()
})

describe('seeding the per-style fees', () => {
  it('copies the global fees to every style and keeps the marks', async () => {
    db = await createTestDb({ before: MIGRATION })
    await db.query(
      `update public.pizza_settings set split_halves_fee_cents = 1500, split_thirds_fee_cents = 2500, split_quarters_fee_cents = 3500`,
    )
    await db.query(`update public.pizza_styles set charges_elaboration = true where name = 'Estilo Hawaiana'`)
    await applyMigration(db, MIGRATION)

    const fees = await feesByStyle()
    expect(fees['Estilo Hawaiana']).toEqual({ halves: 1500, thirds: 2500, quarters: 3500 })
    expect(fees['Estilo Varas']).toEqual({ halves: 1500, thirds: 2500, quarters: 3500 })
    expect(fees['Estilo Vegetariana']).toEqual({ halves: 1500, thirds: 2500, quarters: 3500 })
    expect(fees['Estilo Italiana']).toEqual({ halves: 1500, thirds: 2500, quarters: 3500 })
    expect(fees['Estilo Pepperoni']).toEqual({ halves: 1500, thirds: 2500, quarters: 3500 })
    expect(fees['Arma tu combinación']).toEqual({ halves: 1500, thirds: 2500, quarters: 3500 })
    const marked = await marks()
    expect(marked['Estilo Hawaiana']).toBe(true)
    expect(marked['Estilo Varas']).toBe(true)
    expect(marked['Estilo Italiana']).toBe(false)
    expect(marked['Arma tu combinación']).toBe(false)
  }, 60_000)

  it('keeps today\'s totals', async () => {
    db = await createTestDb()
    await setup()
    // (21000 + 25000) / 2 = 23000, + $10 halves fee of Varas
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Hawaiana'), portion('Estilo Varas')] })).toBe(24000)
    // same average, + $20 thirds fee
    const thirds = [portion('Estilo Hawaiana'), portion('Estilo Pepperoni'), portion('Estilo Varas')]
    expect(await totalOf({ size: 'grande', portions: thirds })).toBe(25000)
    // unmarked styles pay no fee
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Hawaiana'), portion('Estilo Pepperoni')] })).toBe(21000)
  }, 60_000)
})

// Grande seed prices: Hawaiana, Italiana, Pepperoni and Arma tu combinación 21000; Varas 25000.
describe('elaboration fee per style', () => {
  async function fresh() {
    db = await createTestDb()
    await setup()
  }

  it.each([
    [2, 21000 + 1500],
    [3, 21000 + 2500],
    [4, 21000 + 4000],
  ])('charges the style\'s own fee for %i portions', async (count, total) => {
    await fresh()
    await setFees('Estilo Hawaiana', { halves: 1500, thirds: 2500, quarters: 4000 })
    const others = [portion('Estilo Italiana'), portion('Estilo Pepperoni'), portion('Arma tu combinación', { ingredient_ids: ingredientIds.slice(0, 2) })]
    const portions = [portion('Estilo Hawaiana'), ...others.slice(0, count - 1)]
    expect(await totalOf({ size: 'grande', portions })).toBe(total)
  }, 60_000)

  it('charges one fee, the highest among the marked styles', async () => {
    await fresh()
    await setFees('Estilo Hawaiana', { halves: 1000, thirds: 0, quarters: 0 })
    await setFees('Estilo Italiana', { halves: 2000, thirds: 0, quarters: 0 })
    await setFees('Estilo Pepperoni', { halves: 3000, thirds: 500, quarters: 0 })
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Hawaiana'), portion('Estilo Italiana')] })).toBe(23000)
    const thirds = [portion('Estilo Hawaiana'), portion('Estilo Italiana'), portion('Estilo Pepperoni')]
    expect(await totalOf({ size: 'grande', portions: thirds })).toBe(21500)
    // Pepperoni turned off: its $30 halves fee no longer counts
    await setFees('Estilo Pepperoni', { halves: 3000, thirds: 500, quarters: 0 }, false)
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Italiana'), portion('Estilo Pepperoni')] })).toBe(23000)
  }, 60_000)

  it('charges nothing for unmarked styles whatever their amounts', async () => {
    await fresh()
    await setFees('Estilo Hawaiana', { halves: 1500, thirds: 2500, quarters: 4000 }, false)
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Hawaiana'), portion('Estilo Pepperoni')] })).toBe(21000)
  }, 60_000)

  it('charges no fee on a whole pizza or a single-style split', async () => {
    await fresh()
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Varas')] })).toBe(25000)
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Varas'), portion('Estilo Varas')] })).toBe(25000)
  }, 60_000)

  it('no longer reads the global fees', async () => {
    await fresh()
    await asSuperuser(db)
    await db.query(`update public.pizza_settings set split_halves_fee_cents = 9900`)
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Hawaiana'), portion('Estilo Varas')] })).toBe(24000)
  }, 60_000)

  it('keeps extra ingredients on top', async () => {
    await fresh()
    const portions = [portion('Estilo Hawaiana', { extra_ingredient_ids: ingredientIds }), portion('Estilo Varas')]
    // 23000 average + $10 fee + 3 x $5 extra ingredients
    expect(await totalOf({ size: 'grande', portions })).toBe(25500)
  }, 60_000)

  it('lets the admin save a style\'s fees', async () => {
    await fresh()
    await saveStyle({
      id: styleIds['Estilo Pepperoni'],
      name: 'Estilo Pepperoni',
      fees: { halves: 1200, thirds: 0, quarters: 3300 },
      charges: true,
    })
    expect((await feesByStyle())['Estilo Pepperoni']).toEqual({ halves: 1200, thirds: 0, quarters: 3300 })
    // (21000 + 21000) / 2 = 21000, + $12 halves fee
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Hawaiana'), portion('Estilo Pepperoni')] })).toBe(22200)
  }, 60_000)

  it('lets the admin turn a style\'s fee off and on, keeping its amounts', async () => {
    await fresh()
    await saveStyle({ id: styleIds['Estilo Varas'], name: 'Estilo Varas', charges: false })
    expect((await marks())['Estilo Varas']).toBe(false)
    expect((await feesByStyle())['Estilo Varas']).toEqual({ halves: 1000, thirds: 2000, quarters: 3000 })
    // (21000 + 21000) / 2 = 21000 (Varas saved at the test prices), no fee
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Hawaiana'), portion('Estilo Varas')] })).toBe(21000)
    await saveStyle({ id: styleIds['Estilo Varas'], name: 'Estilo Varas', charges: true })
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Hawaiana'), portion('Estilo Varas')] })).toBe(22000)
  }, 60_000)

  it('keeps the fees and the mark when the admin saves without them', async () => {
    await fresh()
    await saveStyle({ id: styleIds['Estilo Varas'], name: 'Estilo Varas' })
    expect((await feesByStyle())['Estilo Varas']).toEqual({ halves: 1000, thirds: 2000, quarters: 3000 })
    expect((await marks())['Estilo Varas']).toBe(true)
  }, 60_000)

  it('gives a new style $0 fees, turned off, unless the admin sets them', async () => {
    await fresh()
    await saveStyle({ name: 'Estilo Nuevo' })
    await saveStyle({ name: 'Estilo Caro', fees: { halves: 500, thirds: 600, quarters: 700 }, charges: true })
    const fees = await feesByStyle()
    expect(fees['Estilo Nuevo']).toEqual({ halves: 0, thirds: 0, quarters: 0 })
    expect(fees['Estilo Caro']).toEqual({ halves: 500, thirds: 600, quarters: 700 })
    const marked = await marks()
    expect(marked['Estilo Nuevo']).toBe(false)
    expect(marked['Estilo Caro']).toBe(true)
  }, 60_000)

  it.each([
    [{ halves: -1, thirds: 0, quarters: 0 }, 'El cargo por elaboración de Mitades no es válido.'],
    [{ halves: 0, thirds: 10.5, quarters: 0 }, 'El cargo por elaboración de Tercios no es válido.'],
    [{ halves: 0, thirds: 0, quarters: 10_000_001 }, 'El cargo por elaboración de Cuartos no es válido.'],
    [{ halves: 0, thirds: 0 }, 'El cargo por elaboración de Cuartos no es válido.'],
    [{ halves: '100', thirds: 0, quarters: 0 }, 'El cargo por elaboración de Mitades no es válido.'],
    [[1, 2, 3], 'El cargo por elaboración de Mitades no es válido.'],
  ])('rejects fees %j and changes nothing', async (fees, message) => {
    await fresh()
    const before = await feesByStyle()
    await expect(
      saveStyle({ id: styleIds['Estilo Varas'], name: 'Estilo Varas', fees, charges: false }),
    ).rejects.toThrow(message)
    expect(await feesByStyle()).toEqual(before)
    expect((await marks())['Estilo Varas']).toBe(true)
  }, 60_000)

  it('rejects a cashier changing the fees and changes nothing', async () => {
    await fresh()
    const before = await feesByStyle()
    const beforeMarks = await marks()
    await expect(
      saveStyle({
        id: styleIds['Estilo Hawaiana'],
        name: 'Estilo Hawaiana',
        fees: { halves: 1, thirds: 1, quarters: 1 },
        charges: true,
        as: cashier,
      }),
    ).rejects.toThrow('Solo un administrador puede editar las pizzas.')
    expect(await feesByStyle()).toEqual(before)
    expect(await marks()).toEqual(beforeMarks)
  }, 60_000)

  it('rejects negative fees written directly', async () => {
    await fresh()
    await expect(setFees('Estilo Varas', { halves: -1, thirds: 0, quarters: 0 })).rejects.toThrow()
  }, 60_000)
})
