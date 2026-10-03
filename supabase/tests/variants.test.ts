// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

async function rpc(db: TestDb, sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

let db: TestDb
let fx: Awaited<ReturnType<typeof loadFixture>>
let burgerId: string
let cashier: string

async function createOrder(items: Json[]) {
  await asUser(db, cashier)
  const res = await rpc(db, 'public.create_order($1, $2, $3::jsonb, $4)', [3, null, JSON.stringify(items), null])
  return res.order_id as string
}

async function quote(orderId: string) {
  await asUser(db, cashier)
  return rpc(db, 'public.quote_order($1)', [orderId])
}

async function itemRows(orderId: string) {
  await asSuperuser(db)
  const res = await db.query<{ variant: string | null; quantity: number; product_name: string }>(
    `select variant, quantity, product_name from public.order_items where order_id = $1 order by variant nulls first, id`,
    [orderId],
  )
  return res.rows
}

const burger = (variant?: unknown, quantity = 1) => ({
  product_id: burgerId,
  quantity,
  ...(variant === undefined ? {} : { variant }),
})

beforeEach(async () => {
  db = await createTestDb()
  fx = await loadFixture(db)
  await asSuperuser(db)
  const res = await db.query<{ id: string }>(
    `insert into public.products (category_id, name, price_cents, active, variants)
     values ($1, 'Hamburguesa X', 8000, true, '{Res,Pollo}') returning id`,
    [fx.categoryId],
  )
  burgerId = res.rows[0].id
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('insert_order_lines variants', () => {
  it('requires a variant when the product has variants', async () => {
    await expect(createOrder([burger()])).rejects.toThrow('Elige una opción para Hamburguesa X')
    await expect(createOrder([burger(null)])).rejects.toThrow('Elige una opción para Hamburguesa X')
    await expect(createOrder([burger('  ')])).rejects.toThrow('Elige una opción para Hamburguesa X')
  })

  it('rejects a variant not in the product list', async () => {
    await expect(createOrder([burger('Cerdo')])).rejects.toThrow('Opción no válida para Hamburguesa X')
  })

  it('rejects a variant on a product without variants', async () => {
    await expect(createOrder([{ product_id: fx.sodaId, quantity: 1, variant: 'Res' }])).rejects.toThrow(
      'Refresco no tiene opciones',
    )
  })

  it('matches case-insensitively and stores the canonical spelling', async () => {
    const id = await createOrder([burger('  pOLLO ')])
    expect(await itemRows(id)).toEqual([{ variant: 'Pollo', quantity: 1, product_name: 'Hamburguesa X' }])
  })

  it('merges same product and variant, keeps different variants apart', async () => {
    const id = await createOrder([burger('Pollo'), burger('pollo', 2), burger('Res')])
    expect(await itemRows(id)).toEqual([
      { variant: 'Pollo', quantity: 3, product_name: 'Hamburguesa X' },
      { variant: 'Res', quantity: 1, product_name: 'Hamburguesa X' },
    ])
  })

  it('still merges products without variants', async () => {
    const id = await createOrder([
      { product_id: fx.sodaId, quantity: 1 },
      { product_id: fx.sodaId, quantity: 2, variant: null },
    ])
    expect(await itemRows(id)).toEqual([{ variant: null, quantity: 3, product_name: 'Refresco' }])
  })
})

describe('pricing and payment', () => {
  it('suffixes the variant in quote_order', async () => {
    const id = await createOrder([burger('Pollo', 2), { product_id: fx.sodaId, quantity: 1 }])
    const q = await quote(id)
    expect(q.total_cents).toBe(18000)
    expect(q.lines.map((l: Json) => l.name)).toEqual(['Hamburguesa X (Pollo)', 'Refresco'])
  })

  it('carries the suffix into sale_items', async () => {
    const id = await createOrder([burger('Res')])
    await asUser(db, cashier)
    await rpc(db, 'public.open_cash_session($1)', [0])
    const paid = await rpc(db, 'public.pay_order($1, $2)', [id, 8000])
    await asSuperuser(db)
    const items = await db.query<{ product_name: string }>(`select product_name from public.sale_items where sale_id = $1`, [
      paid.sale_id,
    ])
    expect(items.rows).toEqual([{ product_name: 'Hamburguesa X (Res)' }])
  })

  it('keeps legacy lines without variant payable', async () => {
    const id = await createOrder([{ product_id: fx.sodaId, quantity: 1 }])
    await asSuperuser(db)
    await db.query(
      `insert into public.order_items (order_id, item_type, product_id, product_name, quantity)
       values ($1, 'product', $2, 'Hamburguesa X', 1)`,
      [id, burgerId],
    )
    const q = await quote(id)
    expect(q.payable).toBe(true)
    expect(q.lines.map((l: Json) => l.name).sort()).toEqual(['Hamburguesa X', 'Refresco'])

    await asUser(db, cashier)
    await rpc(db, 'public.open_cash_session($1)', [0])
    const paid = await rpc(db, 'public.pay_order($1, $2)', [id, 10_000])
    expect(paid.total_cents).toBe(10_000)
  })
})

describe('constraints', () => {
  const insertVariants = async (variants: string[]) => {
    await asSuperuser(db)
    await db.query(`insert into public.products (category_id, name, price_cents, variants) values ($1, 'T', 100, $2)`, [
      fx.categoryId,
      variants,
    ])
  }

  it('rejects blank, duplicate, long and too many variants', async () => {
    await expect(insertVariants(['Res', ' '])).rejects.toThrow()
    await expect(insertVariants(['Res', 'res'])).rejects.toThrow()
    await expect(insertVariants(['x'.repeat(41)])).rejects.toThrow()
    await expect(insertVariants(Array.from({ length: 9 }, (_, i) => `v${i}`))).rejects.toThrow()
  })

  it('accepts a valid list', async () => {
    await expect(insertVariants(['Res', 'Pollo'])).resolves.toBeUndefined()
  })

  it('rejects a blank order_items.variant', async () => {
    const id = await createOrder([{ product_id: fx.sodaId, quantity: 1 }])
    await asSuperuser(db)
    await expect(
      db.query(`update public.order_items set variant = ' ' where order_id = $1`, [id]),
    ).rejects.toThrow()
  })
})

describe('burger seed', () => {
  it('sets Res/Pollo on Hamburguesas products without variants', async () => {
    await asSuperuser(db)
    const cat = await db.query<{ id: string }>(
      `insert into public.categories (name, sort_order) values ('Hamburguesas', 2) returning id`,
    )
    await db.query(
      `insert into public.products (category_id, name, price_cents) values ($1, 'Monster', 9000), ($1, 'Custom', 9000)`,
      [cat.rows[0].id],
    )
    await db.query(`update public.products set variants = '{Solo}' where name = 'Custom'`)

    // Migrations already ran; replay the seed statement from the migration.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const sql = readFileSync(join(import.meta.dirname, '..', 'migrations', '20261006120000_product_variants.sql'), 'utf8')
    const seed = sql.match(/update public\.products\s+set variants[\s\S]*?;/i)
    expect(seed).not.toBeNull()
    await db.exec(seed![0])

    const res = await db.query<{ name: string; variants: string[] }>(
      `select name, variants from public.products where category_id = $1 order by name`,
      [cat.rows[0].id],
    )
    expect(res.rows).toEqual([
      { name: 'Custom', variants: ['Solo'] },
      { name: 'Monster', variants: ['Res', 'Pollo'] },
    ])
  })
})

describe('wings seed', () => {
  it('sets sauce flavors on Botanas "Alitas 5 pzas" only when it has no variants', async () => {
    await asSuperuser(db)
    const cat = await db.query<{ id: string }>(
      `insert into public.categories (name, sort_order) values ('Botanas', 3) returning id`,
    )
    await db.query(
      `insert into public.products (category_id, name, price_cents) values ($1, 'Alitas 5 pzas', 6000), ($1, 'Nuggets', 7000)`,
      [cat.rows[0].id],
    )
    await db.query(
      `insert into public.products (category_id, name, price_cents, variants) values ($1, 'Alitas 5 pzas', 6000, '{Solo}')`,
      [fx.categoryId],
    )

    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const sql = readFileSync(join(import.meta.dirname, '..', 'migrations', '20261008120000_wings_flavors.sql'), 'utf8')
    await db.exec(sql)

    const res = await db.query<{ category_id: string; name: string; variants: string[] }>(
      `select category_id, name, variants from public.products where name in ('Alitas 5 pzas', 'Nuggets') order by name, category_id = $1 desc`,
      [cat.rows[0].id],
    )
    expect(res.rows.map(({ name, variants }) => ({ name, variants }))).toEqual([
      { name: 'Alitas 5 pzas', variants: ['Búfalo', 'BBQ', 'Mango-Habanero'] },
      { name: 'Alitas 5 pzas', variants: ['Solo'] },
      { name: 'Nuggets', variants: [] },
    ])
  })
})

describe('wings natural flavor', () => {
  it('appends Naturales to already-seeded wings and leaves other variants untouched', async () => {
    await asSuperuser(db)
    const cat = await db.query<{ id: string }>(
      `insert into public.categories (name, sort_order) values ('Botanas', 3) returning id`,
    )
    await db.query(
      `insert into public.products (category_id, name, price_cents, variants) values
         ($1, 'Alitas 5 pzas', 6000, '{Búfalo,BBQ,Mango-Habanero}'),
         ($1, 'Alitas 5 pzas', 6000, '{Bufalo,BQ,Mango-Abanero}'),
         ($1, 'Alitas 5 pzas', 6000, '{Solo}')`,
      [cat.rows[0].id],
    )

    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const sql = readFileSync(
      join(import.meta.dirname, '..', 'migrations', '20261009120000_wings_natural_flavor.sql'),
      'utf8',
    )
    await db.exec(sql)
    await db.exec(sql)

    const res = await db.query<{ variants: string[] }>(
      `select variants from public.products where category_id = $1 order by array_length(variants, 1), variants`,
      [cat.rows[0].id],
    )
    expect(res.rows.map((r) => r.variants)).toEqual([
      ['Solo'],
      ['Búfalo', 'BBQ', 'Mango-Habanero', 'Naturales'],
      ['Búfalo', 'BBQ', 'Mango-Habanero', 'Naturales'],
    ])
  })
})

describe('device RPCs', () => {
  it('exposes variants in the catalog and variant in open orders', async () => {
    const admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
    await asUser(db, admin)
    const waiterId = (await rpc(db, 'public.admin_create_waiter($1, $2)', ['Luis', '1234'])).waiter_id
    const secret = (await rpc(db, 'public.admin_register_device($1)', ['Tablet 1'])).device_secret
    await asAnon(db)
    const token = (await rpc(db, 'public.device_start_shift($1, $2, $3)', [secret, waiterId, '1234'])).token

    await rpc(db, 'public.device_create_order($1, $2, $3, $4, $5::jsonb)', [
      secret,
      token,
      2,
      null,
      JSON.stringify([burger('pollo'), { product_id: fx.sodaId, quantity: 1 }]),
    ])

    const catalog = await rpc(db, 'public.device_list_catalog($1)', [secret])
    const byName = Object.fromEntries(catalog.products.map((p: Json) => [p.name, p]))
    expect(byName['Hamburguesa X'].variants).toEqual(['Res', 'Pollo'])
    expect(byName['Refresco'].variants).toEqual([])

    const open = await rpc(db, 'public.device_list_open_orders($1)', [secret])
    const items = open[0].order_items as Json[]
    expect(items.find((i) => i.product_name === 'Hamburguesa X')?.variant).toBe('Pollo')
    expect(items.find((i) => i.product_name === 'Refresco')?.variant).toBeNull()
  })
})
