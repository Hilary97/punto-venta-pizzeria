// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSuperuser, asUser, createProfile, createTestDb, type TestDb } from './db.ts'

type Json = Record<string, any>

let db: TestDb
let admin: string
let cashier: string

const PRICES = { chica: 11000, mediana: 19000, grande: 21000 }

interface StyleArgs {
  id?: string | null
  name?: string
  description?: string
  kind?: string
  included?: number | null
  sortOrder?: number | null
  active?: boolean | null
  prices?: unknown
  fees?: unknown
}

async function saveStyle(user: string, args: StyleArgs = {}): Promise<Json> {
  await asUser(db, user)
  const res = await db.query<{ r: Json }>(
    `select public.admin_save_pizza_style($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb) as r`,
    [
      args.id ?? null,
      args.name ?? 'Estilo Nuevo',
      args.description ?? 'Jamón y queso',
      args.kind ?? 'special',
      args.included === undefined ? 0 : args.included,
      args.sortOrder === undefined ? 20 : args.sortOrder,
      args.active === undefined ? true : args.active,
      JSON.stringify(args.prices === undefined ? PRICES : args.prices),
      args.fees === undefined ? null : JSON.stringify(args.fees),
    ],
  )
  return res.rows[0].r
}

async function styleSnapshot() {
  await asSuperuser(db)
  const styles = await db.query(`select * from public.pizza_styles order by id`)
  const prices = await db.query(`select * from public.pizza_style_prices order by style_id, size_code`)
  return { styles: styles.rows, prices: prices.rows }
}

async function styleRow(id: string) {
  await asSuperuser(db)
  const style = await db.query<Json>(`select * from public.pizza_styles where id = $1`, [id])
  const prices = await db.query<{ size_code: string; price_cents: number }>(
    `select size_code, price_cents from public.pizza_style_prices where style_id = $1`,
    [id],
  )
  return {
    style: style.rows[0],
    prices: Object.fromEntries(prices.rows.map((row) => [row.size_code, row.price_cents])),
  }
}

/** Runs a rejected save and checks no style or price row changed. */
async function rejectsWithoutChanges(user: string, args: StyleArgs, message: string) {
  const before = await styleSnapshot()
  await expect(saveStyle(user, args)).rejects.toThrow(message)
  expect(await styleSnapshot()).toEqual(before)
}

beforeEach(async () => {
  db = await createTestDb()
  admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('admin_save_pizza_style', () => {
  it('creates a style with its three prices', async () => {
    const result = await saveStyle(admin, { name: '  Estilo Nuevo  ' })

    const saved = await styleRow(result.style_id)
    expect(saved.style).toMatchObject({
      name: 'Estilo Nuevo',
      description: 'Jamón y queso',
      kind: 'special',
      included_ingredients: 0,
      sort_order: 20,
      active: true,
    })
    expect(saved.prices).toEqual(PRICES)
  })

  it('updates an existing style and its prices in place', async () => {
    const { style_id } = await saveStyle(admin)

    const result = await saveStyle(admin, {
      id: style_id,
      name: 'Arma tu doble',
      description: 'Elige tres',
      kind: 'custom',
      included: 3,
      sortOrder: 2,
      active: false,
      prices: { chica: 12000, mediana: 20000, grande: 25000 },
    })

    expect(result.style_id).toBe(style_id)
    const saved = await styleRow(style_id)
    expect(saved.style).toMatchObject({
      name: 'Arma tu doble',
      description: 'Elige tres',
      kind: 'custom',
      included_ingredients: 3,
      sort_order: 2,
      active: false,
    })
    expect(saved.prices).toEqual({ chica: 12000, mediana: 20000, grande: 25000 })
  })

  it('stores the included ingredients of a special style', async () => {
    const { style_id } = await saveStyle(admin, { kind: 'special', included: 3 })

    expect((await styleRow(style_id)).style.included_ingredients).toBe(3)
  })

  it('rejects non-admins without changes', async () => {
    await rejectsWithoutChanges(cashier, {}, 'Solo un administrador puede editar las pizzas.')
  })

  it('rejects a blank or too long name', async () => {
    await rejectsWithoutChanges(admin, { name: '   ' }, 'El nombre del estilo debe tener entre 1 y 80 caracteres.')
    await rejectsWithoutChanges(admin, { name: 'x'.repeat(81) }, 'El nombre del estilo debe tener entre 1 y 80 caracteres.')
  })

  it('rejects a too long description', async () => {
    await rejectsWithoutChanges(admin, { description: 'x'.repeat(301) }, 'La descripción del estilo es demasiado larga.')
  })

  it('rejects an unknown kind', async () => {
    await rejectsWithoutChanges(admin, { kind: 'promo' }, 'El tipo de estilo no es válido.')
  })

  it('rejects a custom style that includes fewer than 1 or more than 4 ingredients', async () => {
    const message = 'Los ingredientes incluidos deben estar entre 1 y 4.'
    await rejectsWithoutChanges(admin, { kind: 'custom', included: 0 }, message)
    await rejectsWithoutChanges(admin, { kind: 'custom', included: 5 }, message)
    await rejectsWithoutChanges(admin, { kind: 'custom', included: null }, message)
  })

  it('rejects an order outside 0-10000', async () => {
    await rejectsWithoutChanges(admin, { sortOrder: -1 }, 'El orden no es válido.')
    await rejectsWithoutChanges(admin, { sortOrder: 10001 }, 'El orden no es válido.')
  })

  it('rejects a missing, non-integer or out of range price naming the size', async () => {
    await rejectsWithoutChanges(admin, { prices: { chica: 11000, mediana: 19000 } }, 'El precio de Grande no es válido.')
    await rejectsWithoutChanges(admin, { prices: { ...PRICES, chica: 0 } }, 'El precio de Chica no es válido.')
    await rejectsWithoutChanges(admin, { prices: { ...PRICES, mediana: 10.5 } }, 'El precio de Mediana no es válido.')
    await rejectsWithoutChanges(admin, { prices: { ...PRICES, mediana: '190' } }, 'El precio de Mediana no es válido.')
    await rejectsWithoutChanges(admin, { prices: { ...PRICES, grande: 10_000_001 } }, 'El precio de Grande no es válido.')
    await rejectsWithoutChanges(admin, { prices: [1, 2, 3] }, 'El precio de Grande no es válido.')
  })

  it('accepts whole prices written with a decimal point', async () => {
    await asUser(db, admin)
    const res = await db.query<{ r: Json }>(
      `select public.admin_save_pizza_style(null, 'Estilo Punto', '', 'special', 0, 0, true,
         '{"chica": 11000.0, "mediana": 19000, "grande": 21000}'::jsonb, null) as r`,
    )

    expect((await styleRow(res.rows[0].r.style_id)).prices).toEqual(PRICES)
  })

  it('rejects a duplicate name', async () => {
    await rejectsWithoutChanges(admin, { name: 'Estilo Varas' }, 'Ya existe un estilo con ese nombre.')
  })

  it('rejects an unknown style id', async () => {
    await rejectsWithoutChanges(admin, { id: crypto.randomUUID() }, 'El estilo no existe.')
  })

  it('keeps an existing style unchanged when a later price is invalid', async () => {
    const { style_id } = await saveStyle(admin)

    await rejectsWithoutChanges(
      admin,
      { id: style_id, name: 'Otro nombre', prices: { ...PRICES, grande: -5 } },
      'El precio de Grande no es válido.',
    )
  })
})

describe('pizza catalog checks', () => {
  async function updateSize(portions: string) {
    await asUser(db, admin)
    await db.query(`update public.pizza_sizes set allowed_portions = $1::integer[] where code = 'grande'`, [portions])
  }

  it('lets an admin change a size name and its allowed portions', async () => {
    await asUser(db, admin)
    await db.query(`update public.pizza_sizes set name = 'Familiar', allowed_portions = '{1,2}' where code = 'grande'`)

    await asSuperuser(db)
    const res = await db.query(`select name, allowed_portions from public.pizza_sizes where code = 'grande'`)
    expect(res.rows[0]).toEqual({ name: 'Familiar', allowed_portions: [1, 2] })
  })

  it('rejects empty or out of range allowed portions', async () => {
    await expect(updateSize('{}')).rejects.toThrow(/pizza_sizes_allowed_portions_check/)
    await expect(updateSize('{1,5}')).rejects.toThrow(/pizza_sizes_allowed_portions_check/)
    await expect(updateSize('{0}')).rejects.toThrow(/pizza_sizes_allowed_portions_check/)
  })

  it('rejects blank size and ingredient names', async () => {
    await asUser(db, admin)
    await expect(db.query(`update public.pizza_sizes set name = '  ' where code = 'chica'`)).rejects.toThrow(
      /pizza_sizes_name_check/,
    )
    await expect(db.query(`insert into public.pizza_ingredients (name) values (' ')`)).rejects.toThrow(
      /pizza_ingredients_name_check/,
    )
  })

  it('still lets only admins write ingredients', async () => {
    await asUser(db, cashier)
    await expect(db.query(`insert into public.pizza_ingredients (name) values ('Elote')`)).rejects.toThrow()

    await asUser(db, admin)
    await db.query(`insert into public.pizza_ingredients (name, sort_order) values ('Elote', 16)`)
    const res = await db.query(`select count(*)::int as n from public.pizza_ingredients where name = 'Elote'`)
    expect(res.rows[0]).toEqual({ n: 1 })
  })
})
