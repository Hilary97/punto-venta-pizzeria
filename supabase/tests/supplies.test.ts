// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asSuperuser, asUser, createProfile, createTestDb, type TestDb } from './db.ts'

type Json = Record<string, any>

async function rpc(db: TestDb, sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

let db: TestDb
let admin: string
let cashier: string
let cheese: string

async function addSupply(name: string, unit = 'kg', stock = 0, stockMin = 0): Promise<string> {
  await asSuperuser(db)
  const res = await db.query<{ id: string }>(
    `insert into public.supplies (name, unit, stock, stock_min) values ($1, $2, $3, $4) returning id`,
    [name, unit, stock, stockMin],
  )
  return res.rows[0].id
}

async function stockOf(id: string): Promise<number> {
  await asSuperuser(db)
  const res = await db.query<{ stock: string }>(`select stock from public.supplies where id = $1`, [id])
  return Number(res.rows[0].stock)
}

async function countMovements(): Promise<number> {
  await asSuperuser(db)
  const res = await db.query<{ n: number }>(`select count(*)::int as n from public.supply_movements`)
  return res.rows[0].n
}

async function purchase(supplyId: string, quantity: number | null, cost: number | null, as = admin) {
  await asUser(db, as)
  return rpc(db, 'public.admin_record_supply_purchase($1, $2, $3)', [supplyId, quantity, cost])
}

async function count(supplyId: string, counted: number | null, as = admin) {
  await asUser(db, as)
  return rpc(db, 'public.admin_count_supply($1, $2)', [supplyId, counted])
}

async function listPurchases(from: string | null, to: string | null, as = admin): Promise<Json[]> {
  await asUser(db, as)
  return (await rpc(db, 'public.admin_list_supply_purchases($1, $2)', [from, to])) as unknown as Json[]
}

/** Inserts a movement directly (as superuser) with a fixed timestamp. */
async function seedMovement(supplyId: string, kind: string, createdAt: string, cost: number | null, by = admin) {
  await asSuperuser(db)
  await db.query(
    `insert into public.supply_movements (supply_id, kind, quantity, cost_cents, stock_after, created_by, created_at)
     values ($1, $2, 1, $3, 1, $4, $5)`,
    [supplyId, kind, cost, by, createdAt],
  )
}

beforeEach(async () => {
  db = await createTestDb()
  admin = await createProfile(db, { role: 'admin', fullName: 'Ana Admin' })
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  cheese = await addSupply('Queso', 'kg', 3, 5)
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('S4 purchase', () => {
  it('adds the quantity to the stock and writes the movement', async () => {
    const res = await purchase(cheese, 10.5, 25050)
    expect(Number(res.stock)).toBe(13.5)
    expect(res.supply_id).toBe(cheese)
    expect(await stockOf(cheese)).toBe(13.5)

    await asSuperuser(db)
    const mv = await db.query<Json>(`select * from public.supply_movements`)
    expect(mv.rows).toHaveLength(1)
    expect(mv.rows[0]).toMatchObject({ supply_id: cheese, kind: 'purchase', cost_cents: 25050, created_by: admin })
    expect(Number(mv.rows[0].quantity)).toBe(10.5)
    expect(Number(mv.rows[0].stock_after)).toBe(13.5)
  })

  it('accepts a free purchase (cost 0) and keeps 3 decimals', async () => {
    await purchase(cheese, 0.25, 0)
    expect(await stockOf(cheese)).toBe(3.25)
  })

  it('rejects zero, negative or null quantities', async () => {
    for (const q of [0, -1, null]) {
      await expect(purchase(cheese, q, 100)).rejects.toThrow('La cantidad debe ser mayor a cero.')
    }
    expect(await stockOf(cheese)).toBe(3)
    expect(await countMovements()).toBe(0)
  })

  it('rejects null or negative cost', async () => {
    for (const c of [null, -1]) {
      await expect(purchase(cheese, 1, c)).rejects.toThrow('El monto pagado no es válido.')
    }
    expect(await stockOf(cheese)).toBe(3)
    expect(await countMovements()).toBe(0)
  })

  it('rejects an unknown or inactive supply', async () => {
    await expect(purchase(crypto.randomUUID(), 1, 100)).rejects.toThrow('El insumo no existe.')
    await asSuperuser(db)
    await db.query(`update public.supplies set active = false where id = $1`, [cheese])
    await expect(purchase(cheese, 1, 100)).rejects.toThrow('El insumo no existe.')
    expect(await stockOf(cheese)).toBe(3)
    expect(await countMovements()).toBe(0)
  })
})

describe('S4 count', () => {
  it('sets the stock and writes the movement without cost', async () => {
    const res = await count(cheese, 1.25)
    expect(Number(res.stock)).toBe(1.25)
    expect(await stockOf(cheese)).toBe(1.25)

    await asSuperuser(db)
    const mv = await db.query<Json>(`select * from public.supply_movements`)
    expect(mv.rows).toHaveLength(1)
    expect(mv.rows[0]).toMatchObject({ supply_id: cheese, kind: 'count', cost_cents: null, created_by: admin })
    expect(Number(mv.rows[0].quantity)).toBe(1.25)
    expect(Number(mv.rows[0].stock_after)).toBe(1.25)
  })

  it('accepts zero', async () => {
    await count(cheese, 0)
    expect(await stockOf(cheese)).toBe(0)
  })

  it('rejects negative or null counts', async () => {
    for (const c of [-0.5, null]) {
      await expect(count(cheese, c)).rejects.toThrow('El conteo no puede ser negativo.')
    }
    expect(await stockOf(cheese)).toBe(3)
    expect(await countMovements()).toBe(0)
  })

  it('rejects an unknown or inactive supply', async () => {
    await expect(count(crypto.randomUUID(), 1)).rejects.toThrow('El insumo no existe.')
    await asSuperuser(db)
    await db.query(`update public.supplies set active = false where id = $1`, [cheese])
    await expect(count(cheese, 1)).rejects.toThrow('El insumo no existe.')
    expect(await stockOf(cheese)).toBe(3)
    expect(await countMovements()).toBe(0)
  })
})

describe('S4 overflow and movement time', () => {
  it('rejects a purchase quantity or cost beyond the column ranges and changes nothing', async () => {
    await expect(purchase(cheese, 1000000000, 100)).rejects.toThrow('La cantidad es demasiado grande.')
    await expect(purchase(cheese, 1, 2000000001)).rejects.toThrow('El monto pagado es demasiado grande.')
    const empty = await addSupply('Harina')
    await expect(purchase(empty, 999999999.999, 2000000000)).resolves.toBeDefined()
    expect(await countMovements()).toBe(1)
  })

  it('leaves stock and movements untouched when a purchase overflows', async () => {
    await expect(purchase(cheese, 1000000000, 100)).rejects.toThrow('La cantidad es demasiado grande.')
    await expect(purchase(cheese, 1, 2000000001)).rejects.toThrow('El monto pagado es demasiado grande.')
    expect(await stockOf(cheese)).toBe(3)
    expect(await countMovements()).toBe(0)
  })

  it('rejects a counted value beyond the column range and changes nothing', async () => {
    await expect(count(cheese, 1000000000)).rejects.toThrow('La cantidad es demasiado grande.')
    expect(await stockOf(cheese)).toBe(3)
    expect(await countMovements()).toBe(0)
    await expect(count(cheese, 999999999.999)).resolves.toBeDefined()
  })

  it('stamps movements with the statement clock, not the transaction start', async () => {
    await asUser(db, admin)
    await db.exec('begin')
    try {
      await rpc(db, 'public.admin_record_supply_purchase($1, 1, 100)', [cheese])
      await db.query('select pg_sleep(0.01)')
      await rpc(db, 'public.admin_count_supply($1, 2)', [cheese])
    } finally {
      await db.exec('commit')
    }
    await asSuperuser(db)
    const mv = await db.query<{ kind: string; created_at: string }>(
      `select kind, created_at from public.supply_movements order by created_at`,
    )
    expect(mv.rows.map((r) => r.kind)).toEqual(['purchase', 'count'])
    expect(new Date(mv.rows[1].created_at).getTime()).toBeGreaterThan(new Date(mv.rows[0].created_at).getTime())
  })
})

describe('S2 permissions', () => {
  it('lets only admins call the three RPCs', async () => {
    const msg = 'Solo un administrador puede gestionar insumos.'
    await expect(purchase(cheese, 1, 100, cashier)).rejects.toThrow(msg)
    await expect(count(cheese, 1, cashier)).rejects.toThrow(msg)
    await expect(listPurchases('2026-01-01', '2027-01-01', cashier)).rejects.toThrow(msg)
    expect(await stockOf(cheese)).toBe(3)
    expect(await countMovements()).toBe(0)
  })

  it('denies anon execution of the three RPCs', async () => {
    await asAnon(db)
    await expect(rpc(db, 'public.admin_record_supply_purchase($1, 1, 100)', [cheese])).rejects.toThrow(/permission denied/)
    await expect(rpc(db, 'public.admin_count_supply($1, 1)', [cheese])).rejects.toThrow(/permission denied/)
    await expect(rpc(db, `public.admin_list_supply_purchases(now(), now() + interval '1 day')`)).rejects.toThrow(
      /permission denied/,
    )
  })

  it('hides supplies and movements from cashiers', async () => {
    await purchase(cheese, 1, 100)
    await asUser(db, cashier)
    expect((await db.query(`select * from public.supplies`)).rows).toHaveLength(0)
    expect((await db.query(`select * from public.supply_movements`)).rows).toHaveLength(0)
  })

  it('denies cashier writes on supplies and movements', async () => {
    await asUser(db, cashier)
    await expect(
      db.query(`insert into public.supplies (name, unit) values ('Harina', 'kg')`),
    ).rejects.toThrow(/row-level security/)
    // RLS filters the row out: no error, nothing updated.
    await db.query(`update public.supplies set stock_min = 99 where id = $1`, [cheese])
    await asSuperuser(db)
    expect(Number((await db.query<Json>(`select stock_min from public.supplies`)).rows[0].stock_min)).toBe(5)
    await asUser(db, cashier)
    await expect(db.query(`delete from public.supplies`)).rejects.toThrow(/permission denied/)
    await expect(
      db.query(
        `insert into public.supply_movements (supply_id, kind, quantity, cost_cents, stock_after) values ($1, 'purchase', 1, 1, 1)`,
        [cheese],
      ),
    ).rejects.toThrow(/permission denied/)
  })

  it('denies anon access to supplies and movements', async () => {
    for (const table of ['supplies', 'supply_movements']) {
      await asAnon(db)
      await expect(db.query(`select * from public.${table}`)).rejects.toThrow(/permission denied/)
    }
    await asAnon(db)
    await expect(db.query(`insert into public.supplies (name, unit) values ('Harina', 'kg')`)).rejects.toThrow(
      /permission denied/,
    )
  })

  it('lets admins read supplies and movements, and manage supplies', async () => {
    await purchase(cheese, 1, 100)
    await asUser(db, admin)
    expect((await db.query(`select * from public.supplies`)).rows).toHaveLength(1)
    expect((await db.query(`select * from public.supply_movements`)).rows).toHaveLength(1)
    await db.query(`insert into public.supplies (name, unit, stock_min) values ('Harina', 'kg', 2)`)
    await db.query(`update public.supplies set stock_min = 7, active = false where id = $1`, [cheese])
    const row = (await db.query<Json>(`select stock_min, active from public.supplies where id = $1`, [cheese])).rows[0]
    expect(Number(row.stock_min)).toBe(7)
    expect(row.active).toBe(false)
  })

  it('rejects direct movement writes by admins', async () => {
    await asUser(db, admin)
    await expect(
      db.query(
        `insert into public.supply_movements (supply_id, kind, quantity, cost_cents, stock_after) values ($1, 'purchase', 1, 1, 1)`,
        [cheese],
      ),
    ).rejects.toThrow(/permission denied/)
    await expect(db.query(`update public.supplies set stock = 99 where id = $1`, [cheese])).rejects.toThrow(/permission denied/)
    await expect(db.query(`insert into public.supplies (name, unit, stock) values ('Harina', 'kg', 5)`)).rejects.toThrow(
      /permission denied/,
    )
    await expect(db.query(`update public.supply_movements set quantity = 1`)).rejects.toThrow(/permission denied/)
    await expect(db.query(`delete from public.supply_movements`)).rejects.toThrow(/permission denied/)
    await expect(db.query(`delete from public.supplies`)).rejects.toThrow(/permission denied/)
  })
})

describe('S3 constraints', () => {
  it('rejects units outside the list', async () => {
    await asSuperuser(db)
    await expect(db.query(`insert into public.supplies (name, unit) values ('Aceite', 'kilo')`)).rejects.toThrow(/supplies_unit_valid/)
    for (const unit of ['kg', 'g', 'l', 'ml', 'pz']) {
      await db.query(`insert into public.supplies (name, unit) values ($1, $2)`, [`U-${unit}`, unit])
    }
  })

  it('rejects negative stock and minimum', async () => {
    await asSuperuser(db)
    await expect(db.query(`insert into public.supplies (name, unit, stock) values ('A', 'kg', -1)`)).rejects.toThrow(/stock/)
    await expect(db.query(`insert into public.supplies (name, unit, stock_min) values ('B', 'kg', -1)`)).rejects.toThrow(
      /stock_min/,
    )
    await expect(db.query(`update public.supplies set stock = -1 where id = $1`, [cheese])).rejects.toThrow(/stock/)
  })

  it('rejects duplicate names regardless of case and surrounding spaces', async () => {
    await asSuperuser(db)
    await expect(db.query(`insert into public.supplies (name, unit) values ('QUESO', 'kg')`)).rejects.toThrow(
      /duplicate key|unique/,
    )
    await expect(db.query(`insert into public.supplies (name, unit) values (' queso ', 'g')`)).rejects.toThrow(
      /duplicate key|unique/,
    )
  })

  it('rejects blank names and invalid movement shapes', async () => {
    await asSuperuser(db)
    await expect(db.query(`insert into public.supplies (name, unit) values ('   ', 'kg')`)).rejects.toThrow()
    await expect(
      db.query(`insert into public.supply_movements (supply_id, kind, quantity, cost_cents, stock_after) values ($1, 'other', 1, 1, 1)`, [cheese]),
    ).rejects.toThrow()
    await expect(
      db.query(`insert into public.supply_movements (supply_id, kind, quantity, cost_cents, stock_after) values ($1, 'purchase', 1, -1, 1)`, [cheese]),
    ).rejects.toThrow()
    await expect(
      db.query(`insert into public.supply_movements (supply_id, kind, quantity, cost_cents, stock_after) values ($1, 'purchase', 1, null, 1)`, [cheese]),
    ).rejects.toThrow()
  })
})

describe('S5 purchases list', () => {
  const from = '2026-10-01T00:00:00Z'
  const to = '2026-11-01T00:00:00Z'

  it('includes the lower bound, excludes the upper bound', async () => {
    await seedMovement(cheese, 'purchase', '2026-09-30T23:59:59Z', 100)
    await seedMovement(cheese, 'purchase', from, 200)
    await seedMovement(cheese, 'purchase', '2026-10-31T23:59:59Z', 300)
    await seedMovement(cheese, 'purchase', to, 400)
    const rows = await listPurchases(from, to)
    expect(rows.map((r) => r.cost_cents)).toEqual([300, 200])
  })

  it('orders newest first and excludes counts', async () => {
    await seedMovement(cheese, 'purchase', '2026-10-02T10:00:00Z', 100)
    await seedMovement(cheese, 'count', '2026-10-03T10:00:00Z', null)
    await seedMovement(cheese, 'purchase', '2026-10-04T10:00:00Z', 300)
    const rows = await listPurchases(from, to)
    expect(rows.map((r) => r.cost_cents)).toEqual([300, 100])
  })

  it('returns the documented fields with buyer name', async () => {
    const flour = await addSupply('Harina', 'g')
    await seedMovement(flour, 'purchase', '2026-10-05T10:00:00Z', 1550)
    const [row] = await listPurchases(from, to)
    expect(Object.keys(row).sort()).toEqual(
      ['cost_cents', 'created_at', 'created_by_name', 'id', 'quantity', 'supply_id', 'supply_name', 'unit'].sort(),
    )
    expect(row).toMatchObject({ supply_id: flour, supply_name: 'Harina', unit: 'g', cost_cents: 1550, created_by_name: 'Ana Admin' })
    expect(Number(row.quantity)).toBe(1)
    expect(new Date(row.created_at).toISOString()).toBe('2026-10-05T10:00:00.000Z')
  })

  it('gives a null buyer name when the buyer is missing', async () => {
    await asSuperuser(db)
    await db.query(
      `insert into public.supply_movements (supply_id, kind, quantity, cost_cents, stock_after, created_by, created_at)
       values ($1, 'purchase', 1, 100, 1, null, '2026-10-05T10:00:00Z')`,
      [cheese],
    )
    const [row] = await listPurchases(from, to)
    expect(row.created_by_name).toBeNull()
  })

  it('returns an empty array when nothing matches', async () => {
    expect(await listPurchases(from, to)).toEqual([])
  })

  it('lists a purchase made through the RPC', async () => {
    await purchase(cheese, 2, 5000)
    const rows = await listPurchases('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ supply_name: 'Queso', cost_cents: 5000, created_by_name: 'Ana Admin' })
  })

  it('rejects null and inverted ranges', async () => {
    const msg = 'El rango de fechas no es válido.'
    await expect(listPurchases(null, to)).rejects.toThrow(msg)
    await expect(listPurchases(from, null)).rejects.toThrow(msg)
    await expect(listPurchases(to, from)).rejects.toThrow(msg)
    await expect(listPurchases(from, from)).rejects.toThrow(msg)
  })
})
