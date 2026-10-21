// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyMigration, asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

const MIGRATION = '20261024120000_pizza_dough_cash_shift.sql'

type Json = Record<string, any>

let db: TestDb
let cashier: string
let admin: string
let styleId: string

async function rpc(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

const pizza = (size: string, quantity: number) => ({
  type: 'pizza',
  quantity,
  pizza: { size, portions: [{ style_id: styleId, ingredient_ids: [], extra_ingredient_ids: [], extra_cheese: false }] },
})

/** Rows loaded under the clock-based business day, as production has them before this migration. */
async function legacyRows(rows: { dayOffset: number; size: string; prepared: number; used: number }[]) {
  await asSuperuser(db)
  for (const r of rows) {
    await db.query(
      `insert into public.pizza_dough_days (business_day, size_code, prepared, used)
       values (public.pizza_business_day() + $1::int, $2, $3, $4)`,
      [r.dayOffset, r.size, r.prepared, r.used],
    )
  }
}

async function shiftRows() {
  await asSuperuser(db)
  const res = await db.query<{ shift: number; day: string | null; size_code: string; prepared: number; used: number }>(
    `select d.shift_id::int as shift, (d.business_day - public.pizza_business_day())::text as day, d.size_code, d.prepared, d.used
     from public.pizza_dough_days d order by d.shift_id, d.size_code`,
  )
  return res.rows
}

async function shifts() {
  await asSuperuser(db)
  const res = await db.query<{ id: number; day: string | null }>(
    `select id::int, (business_day - public.pizza_business_day())::text as day from public.pizza_dough_shifts order by id`,
  )
  return res.rows
}

beforeEach(async () => {
  db = await createTestDb({ before: MIGRATION })
  await loadFixture(db)
  await asSuperuser(db)
  styleId = (await db.query<{ id: string }>(`select id from public.pizza_styles where name = 'Estilo Varas'`)).rows[0].id
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe(MIGRATION, () => {
  it("keeps today's load as the current shift and past days as past shifts", async () => {
    await legacyRows([
      { dayOffset: -2, size: 'chica', prepared: 4, used: 4 },
      { dayOffset: -1, size: 'grande', prepared: 6, used: 2 },
      { dayOffset: 0, size: 'chica', prepared: 10, used: 3 },
      { dayOffset: 0, size: 'mediana', prepared: 5, used: 0 },
    ])
    await applyMigration(db, MIGRATION)

    expect(await shifts()).toEqual([
      { id: 1, day: '-2' },
      { id: 2, day: '-1' },
      { id: 3, day: '0' },
    ])
    expect(await shiftRows()).toEqual([
      { shift: 1, day: '-2', size_code: 'chica', prepared: 4, used: 4 },
      { shift: 2, day: '-1', size_code: 'grande', prepared: 6, used: 2 },
      { shift: 3, day: '0', size_code: 'chica', prepared: 10, used: 3 },
      { shift: 3, day: '0', size_code: 'mediana', prepared: 5, used: 0 },
    ])
    await asUser(db, cashier)
    expect(await rpc('public.list_pizza_dough_left()')).toEqual([
      { size_code: 'grande', dough_left: null },
      { size_code: 'mediana', dough_left: 5 },
      { size_code: 'chica', dough_left: 7 },
    ])
  })

  it('adds an empty current shift when nothing was loaded today, so today stays unlimited', async () => {
    await legacyRows([{ dayOffset: -1, size: 'chica', prepared: 2, used: 2 }])
    await applyMigration(db, MIGRATION)

    expect(await shifts()).toEqual([
      { id: 1, day: '-1' },
      { id: 2, day: null },
    ])
    await asUser(db, cashier)
    expect(await rpc('public.list_pizza_dough_left()')).toEqual([
      { size_code: 'grande', dough_left: null },
      { size_code: 'mediana', dough_left: null },
      { size_code: 'chica', dough_left: null },
    ])
  })

  it('starts with one empty shift when there was no dough data at all', async () => {
    await applyMigration(db, MIGRATION)
    expect(await shifts()).toEqual([{ id: 1, day: null }])
    expect(await shiftRows()).toEqual([])
  })

  it('links open orders to the shift of their dough day, so cancelling still gives the dough back', async () => {
    await asUser(db, admin)
    await rpc('public.admin_set_pizza_dough($1, $2)', ['chica', 5])
    await asUser(db, cashier)
    const order = (await rpc('public.create_order($1, $2, $3::jsonb)', [1, null, JSON.stringify([pizza('chica', 2), pizza('grande', 1)])]))
      .order_id as string
    await legacyRows([{ dayOffset: -1, size: 'mediana', prepared: 1, used: 0 }])

    await applyMigration(db, MIGRATION)

    await asSuperuser(db)
    const lines = await db.query<{ shift: number | null; day: string | null }>(
      `select dough_shift::int as shift, dough_day::text as day from public.order_items where order_id = $1 order by pizza ->> 'size'`,
      [order],
    )
    expect(lines.rows.map((l) => l.shift)).toEqual([2, null])
    expect(lines.rows[0].day).not.toBeNull()
    expect(await shiftRows()).toContainEqual({ shift: 2, day: '0', size_code: 'chica', prepared: 5, used: 2 })

    await asUser(db, cashier)
    await rpc('public.cancel_order($1)', [order])
    expect(await shiftRows()).toContainEqual({ shift: 2, day: '0', size_code: 'chica', prepared: 5, used: 0 })
  })

  it('a close after the migration starts the next shift', async () => {
    await legacyRows([{ dayOffset: 0, size: 'chica', prepared: 3, used: 0 }])
    await applyMigration(db, MIGRATION)
    await asUser(db, cashier)
    await rpc('public.open_cash_session($1)', [0])
    await rpc('public.close_cash_session($1)', [0])
    expect((await shifts()).map((s) => s.id)).toEqual([1, 2])
    await asUser(db, cashier)
    expect(await rpc('public.list_pizza_dough_left()')).toContainEqual({ size_code: 'chica', dough_left: null })
  })
})
