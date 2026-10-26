// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyMigration, asAnon, asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

const MIGRATION = '20261107120000_pizza_extras.sql'
const CHEESE_ID = '00000000-0000-4000-8000-000000000001'

type Json = Record<string, any>

let db: TestDb
let cashier: string
let admin: string
let styleIds: Record<string, string>
let jalapenos: string

async function rpc(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

async function loadIds() {
  await asSuperuser(db)
  const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
  styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
  jalapenos = (await db.query<{ id: string }>(`select id from public.pizza_ingredients where name = 'Jalapeños'`)).rows[0].id
}

function portion(style: string, extra: Json = {}) {
  return { style_id: styleIds[style], ingredient_ids: [], extra_ingredient_ids: [], ...extra }
}

function pizzaLine(size: string, portions: Json[]) {
  return { type: 'pizza', quantity: 1, pizza: { size, portions } }
}

async function createOrder(items: Json[]): Promise<string> {
  await asUser(db, cashier)
  return (await rpc('public.create_order($1, $2, $3::jsonb, $4)', [3, null, JSON.stringify(items), null])).order_id
}

async function quote(orderId: string) {
  await asUser(db, cashier)
  return rpc('public.quote_order($1)', [orderId])
}

async function validate(config: unknown) {
  await asSuperuser(db)
  return rpc('public.validate_pizza($1::jsonb)', [JSON.stringify(config)])
}

async function addExtra(name: string, priceCents: number, sortOrder: number, active = true): Promise<string> {
  await asSuperuser(db)
  const res = await db.query<{ id: string }>(
    `insert into public.pizza_extras (name, price_cents, sort_order, active) values ($1, $2, $3, $4) returning id`,
    [name, priceCents, sortOrder, active],
  )
  return res.rows[0].id
}

afterEach(async () => {
  await db.close()
})

describe('migrating extra cheese into the extras list', () => {
  beforeEach(async () => {
    db = await createTestDb({ before: MIGRATION })
    await loadFixture(db)
    await loadIds()
    cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  }, 60_000)

  it('seeds Extra queso with the current extra cheese price and drops the old setting', async () => {
    await asSuperuser(db)
    await db.query(`update public.pizza_settings set extra_cheese_cents = 3500`)
    await applyMigration(db, MIGRATION)

    const extras = await db.query(`select id, name, price_cents, sort_order, active from public.pizza_extras`)
    expect(extras.rows).toEqual([{ id: CHEESE_ID, name: 'Extra queso', price_cents: 3500, sort_order: 1, active: true }])
    const columns = await db.query(
      `select column_name from information_schema.columns where table_name = 'pizza_settings' order by column_name`,
    )
    expect(columns.rows).toEqual([{ column_name: 'extra_ingredient_cents' }, { column_name: 'id' }])
  })

  it('rewrites stored lines to extra_ids and keeps their price and description', async () => {
    const orderId = await createOrder([
      pizzaLine('grande', [
        portion('Estilo Varas', { extra_ingredient_ids: [jalapenos], extra_cheese: true }),
        portion("Estilo Chuy's", { extra_cheese: false }),
      ]),
    ])
    const before = await quote(orderId)

    await asSuperuser(db)
    await applyMigration(db, MIGRATION)

    const stored = await db.query<{ pizza: Json }>(`select pizza from public.order_items where order_id = $1`, [orderId])
    expect(stored.rows[0].pizza.portions).toEqual([
      { style_id: styleIds['Estilo Varas'], ingredient_ids: [], extra_ingredient_ids: [jalapenos], extra_ids: [CHEESE_ID] },
      { style_id: styleIds["Estilo Chuy's"], ingredient_ids: [], extra_ingredient_ids: [], extra_ids: [] },
    ])
    const after = await quote(orderId)
    expect(after.total_cents).toBe(before.total_cents)
    expect(after.total_cents).toBe(28500)
    expect(after.lines[0].name).toBe(before.lines[0].name)
    expect(after.lines[0].name).toBe("Pizza Grande · Mitades: ½ Estilo Varas + Jalapeños + Extra queso | ½ Estilo Chuy's")
  })

  it('keeps migrated lines intact when the rewrite statement runs again', async () => {
    const orderId = await createOrder([pizzaLine('chica', [portion('Estilo Varas', { extra_cheese: true })])])
    await asSuperuser(db)
    await applyMigration(db, MIGRATION)
    const sql = readFileSync(join(import.meta.dirname, '..', 'migrations', MIGRATION), 'utf8')
    const rewrite = sql.slice(sql.indexOf('update public.order_items'), sql.indexOf('alter table public.pizza_settings'))
    await db.exec(rewrite)

    const stored = await db.query<{ pizza: Json }>(`select pizza from public.order_items where order_id = $1`, [orderId])
    expect(stored.rows[0].pizza.portions[0].extra_ids).toEqual([CHEESE_ID])
  })

  it('leaves non-object portions and non-boolean extra_cheese untouched', async () => {
    const orderId = await createOrder([pizzaLine('chica', [portion('Estilo Varas')])])
    await asSuperuser(db)
    const odd = { size: 'chica', portions: [7, { style_id: styleIds['Estilo Varas'], extra_cheese: 'true' }] }
    await db.query(`update public.order_items set pizza = $2::jsonb where order_id = $1`, [orderId, JSON.stringify(odd)])
    await applyMigration(db, MIGRATION)

    const stored = await db.query<{ pizza: Json }>(`select pizza from public.order_items where order_id = $1`, [orderId])
    expect(stored.rows[0].pizza).toEqual(odd)
  })
})

describe('pizza extras', () => {
  let orilla: string

  beforeEach(async () => {
    db = await createTestDb()
    await loadFixture(db)
    await loadIds()
    cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
    admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
    orilla = await addExtra('Orilla rellena', 4000, 2)
  }, 60_000)

  it('canonicalizes extra_ids in catalog order and maps legacy extra_cheese to Extra queso', async () => {
    const config = await validate({
      size: 'grande',
      portions: [portion('Estilo Varas', { extra_ids: [orilla] }), portion("Estilo Chuy's", { extra_cheese: true })],
    })
    expect(config.extra_ids).toEqual([CHEESE_ID, orilla])
  })

  it('does not duplicate Extra queso when sent both ways', async () => {
    const config = await validate({
      size: 'chica',
      portions: [portion('Estilo Varas', { extra_ids: [CHEESE_ID], extra_cheese: true })],
    })
    expect(config.extra_ids).toEqual([CHEESE_ID])
  })

  it('charges legacy per-portion extras once for the whole pizza and lists them after the portions', async () => {
    const q = await quote(
      await createOrder([
        pizzaLine('grande', [
          portion('Estilo Varas', { extra_ingredient_ids: [jalapenos], extra_ids: [orilla, CHEESE_ID] }),
          portion("Estilo Chuy's", { extra_ids: [orilla] }),
        ]),
      ]),
    )
    // 25000 base + 500 jalapeños + 3000 queso + 4000 orilla (once)
    expect(q.total_cents).toBe(32500)
    expect(q.lines[0].name).toBe(
      "Pizza Grande · Mitades: ½ Estilo Varas + Jalapeños | ½ Estilo Chuy's · Extras: Extra queso, Orilla rellena",
    )
  })

  it('applies a price change to extras on open orders', async () => {
    const orderId = await createOrder([pizzaLine('chica', [portion('Estilo Varas', { extra_ids: [orilla] })])])
    const before = (await quote(orderId)).total_cents as number
    await asSuperuser(db)
    await db.query(`update public.pizza_extras set price_cents = 5000 where id = $1`, [orilla])
    expect((await quote(orderId)).total_cents).toBe(before + 1000)
  })

  it('rejects an inactive or unknown extra', async () => {
    const inactive = await addExtra('Doble carne', 3000, 3, false)
    await expect(
      validate({ size: 'chica', portions: [portion('Estilo Varas', { extra_ids: [inactive] })] }),
    ).rejects.toThrow('Uno de los extras no existe o no está activo.')
    await expect(
      validate({ size: 'chica', portions: [portion('Estilo Varas', { extra_ids: [crypto.randomUUID()] })] }),
    ).rejects.toThrow('Uno de los extras no existe o no está activo.')
  })

  it('rejects a repeated pizza extra', async () => {
    await expect(
      validate({ size: 'chica', portions: [portion('Estilo Varas')], extra_ids: [orilla, orilla] }),
    ).rejects.toThrow('Los extras de la pizza no se pueden repetir.')
  })

  it('rejects malformed extra_ids or extra_cheese', async () => {
    await expect(
      validate({ size: 'chica', portions: [portion('Estilo Varas', { extra_ids: ['nope'] })] }),
    ).rejects.toThrow('La configuración de la pizza es inválida.')
    await expect(
      validate({ size: 'chica', portions: [portion('Estilo Varas', { extra_ids: 'x' })] }),
    ).rejects.toThrow('La configuración de la pizza es inválida.')
    await expect(
      validate({ size: 'chica', portions: [portion('Estilo Varas', { extra_cheese: 'yes' })] }),
    ).rejects.toThrow('La configuración de la pizza es inválida.')
  })

  it('lets every signed-in user read extras but only admins write them', async () => {
    await asUser(db, cashier)
    const read = await db.query(`select name from public.pizza_extras order by sort_order`)
    expect(read.rows).toEqual([{ name: 'Extra queso' }, { name: 'Orilla rellena' }])
    await expect(
      db.query(`insert into public.pizza_extras (name, price_cents) values ('Hack', 100)`),
    ).rejects.toThrow()
    const updated = await db.query(`update public.pizza_extras set price_cents = 1 where id = $1`, [orilla])
    expect(updated.affectedRows).toBe(0)

    await asAnon(db)
    await expect(db.query(`select * from public.pizza_extras`)).rejects.toThrow()

    await asUser(db, admin)
    await db.query(`update public.pizza_extras set price_cents = 4500 where id = $1`, [orilla])
    await asSuperuser(db)
    const prices = await db.query(`select price_cents from public.pizza_extras where id = $1`, [orilla])
    expect(prices.rows).toEqual([{ price_cents: 4500 }])
  })

  it('never lets anyone hard-delete an extra', async () => {
    await asUser(db, admin)
    const deleted = await db.query(`delete from public.pizza_extras where id = $1`, [orilla]).catch(() => ({ affectedRows: 0 }))
    expect(deleted.affectedRows ?? 0).toBe(0)
    await asSuperuser(db)
    const count = await db.query<{ n: number }>(`select count(*)::int as n from public.pizza_extras`)
    expect(count.rows[0].n).toBe(2)
  })

  it('rejects a duplicate or blank name and a non-positive price', async () => {
    await asUser(db, admin)
    await expect(
      db.query(`insert into public.pizza_extras (name, price_cents) values ('Orilla rellena', 100)`),
    ).rejects.toThrow(/duplicate key/)
    await expect(db.query(`insert into public.pizza_extras (name, price_cents) values ('  ', 100)`)).rejects.toThrow()
    await expect(db.query(`insert into public.pizza_extras (name, price_cents) values ('Gratis', 0)`)).rejects.toThrow()
    await asSuperuser(db)
    const count = await db.query<{ n: number }>(`select count(*)::int as n from public.pizza_extras`)
    expect(count.rows[0].n).toBe(2)
  })

  it('lists active extras without prices in the device catalog', async () => {
    await addExtra('Doble carne', 3000, 3, false)
    await asUser(db, admin)
    await rpc('public.admin_create_waiter($1, $2)', ['Luis', '1234'])
    const secret = (await rpc('public.admin_register_device($1)', ['Tablet 1'])).device_secret
    await asAnon(db)
    const catalog = await rpc('public.device_list_catalog($1)', [secret])
    expect(catalog.pizza.extras).toEqual([
      { id: CHEESE_ID, name: 'Extra queso', sort_order: 1 },
      { id: orilla, name: 'Orilla rellena', sort_order: 2 },
    ])
    expect(catalog.pizza.ingredients.length).toBeGreaterThan(0)
  })
})
