// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

let db: TestDb
let cashier: string
let admin: string
let styleIds: Record<string, string>
let table = 0

const FEES = 'split_halves_fee_cents, split_thirds_fee_cents, split_quarters_fee_cents'

async function rpc(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

function portion(style: string) {
  return { style_id: styleIds[style], ingredient_ids: [], extra_ingredient_ids: [] }
}

// Varas 25000 and Chuy's 23000 average 24000 however the grande is split.
function split(count: number) {
  const styles = ['Estilo Varas', "Estilo Chuy's"]
  return { size: 'grande', portions: Array.from({ length: count }, (_, i) => portion(styles[i % 2])) }
}

async function totalOf(pizza: Json): Promise<number> {
  await asUser(db, cashier)
  const items = [{ type: 'pizza', quantity: 1, pizza }]
  const orderId = (await rpc('public.create_order($1, $2, $3::jsonb, $4)', [++table, null, JSON.stringify(items), null])).order_id
  return (await rpc('public.quote_order($1)', [orderId])).total_cents
}

async function fees() {
  await asSuperuser(db)
  const res = await db.query<{
    split_halves_fee_cents: number
    split_thirds_fee_cents: number
    split_quarters_fee_cents: number
  }>(`select ${FEES} from public.pizza_settings`)
  return res.rows[0]
}

async function setFees(halves: number, thirds: number, quarters: number) {
  await asSuperuser(db)
  await db.query(
    `update public.pizza_settings set split_halves_fee_cents = $1, split_thirds_fee_cents = $2, split_quarters_fee_cents = $3`,
    [halves, thirds, quarters],
  )
}

afterEach(async () => {
  await db.close()
})

describe('split elaboration fee settings', () => {
  beforeEach(async () => {
    table = 0
    db = await createTestDb()
    await loadFixture(db)
    await asSuperuser(db)
    const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
    styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
    cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
    admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  }, 60_000)

  it('defaults to $10 halves, $20 thirds and $30 quarters', async () => {
    expect(await fees()).toEqual({ split_halves_fee_cents: 1000, split_thirds_fee_cents: 2000, split_quarters_fee_cents: 3000 })
    expect(await totalOf(split(2))).toBe(25000)
    expect(await totalOf(split(3))).toBe(26000)
    expect(await totalOf(split(4))).toBe(27000)
  })

  it.each([
    [2, 24000 + 1500],
    [3, 24000 + 2500],
    [4, 24000 + 4000],
  ])('charges the configured fee for %i portions', async (count, total) => {
    await setFees(1500, 2500, 4000)
    expect(await totalOf(split(count))).toBe(total)
  })

  it('charges no fee when the fee is $0', async () => {
    await setFees(0, 0, 0)
    expect(await totalOf(split(2))).toBe(24000)
  })

  it('charges no fee on a whole pizza or a single-style split', async () => {
    await setFees(1500, 2500, 4000)
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Varas')] })).toBe(25000)
    expect(await totalOf({ size: 'grande', portions: [portion('Estilo Varas'), portion('Estilo Varas')] })).toBe(25000)
  })

  it('lets an admin change the fees', async () => {
    await asUser(db, admin)
    await db.query(`update public.pizza_settings set split_halves_fee_cents = 1500 where id`)
    expect((await fees()).split_halves_fee_cents).toBe(1500)
  })

  it('does not let a cashier change the fees', async () => {
    await asUser(db, cashier)
    await db.query(`update public.pizza_settings set split_halves_fee_cents = 1500 where id`)
    expect((await fees()).split_halves_fee_cents).toBe(1000)
  })

  it.each([
    ['split_halves_fee_cents', -1],
    ['split_thirds_fee_cents', -1],
    ['split_quarters_fee_cents', 10_000_001],
  ])('rejects %s = %i and changes nothing', async (column, value) => {
    await asSuperuser(db)
    await expect(db.query(`update public.pizza_settings set ${column} = $1`, [value])).rejects.toThrow()
    expect(await fees()).toEqual({ split_halves_fee_cents: 1000, split_thirds_fee_cents: 2000, split_quarters_fee_cents: 3000 })
  })
})
