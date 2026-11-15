// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { applyMigration, asAnon, asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

let db: TestDb

const rpc = async (sql: string, p: unknown[] = []): Promise<any> => (await db.query<{ r: any }>(`select ${sql} as r`, p)).rows[0].r

afterEach(async () => {
  await db?.close()
})

/** md5 of every public table, ignoring the new (empty) shortcuts table. */
async function hash() {
  await asSuperuser(db)
  const ts = (await db.query<{ t: string }>(`select tablename t from pg_tables where schemaname='public' order by 1`)).rows
  let acc = ''
  for (const { t } of ts) {
    acc += t + (await db.query<{ h: string }>(`select md5(coalesce(string_agg(x::text,'|' order by x::text),'')) h from public.${t} x`)).rows[0].h + ';'
  }
  return acc.replace(/pizza_note_shortcuts[0-9a-f]+;/, '')
}

const P = (id: string, e: Json = {}) => ({ style_id: id, ingredient_ids: [], extra_ingredient_ids: [], ...e })

it('stored pizzas, prices, descriptions, kitchen lines and picks are unchanged by the migrations', async () => {
  db = await createTestDb({ before: '20261201120000' })
  await loadFixture(db)
  const S = Object.fromEntries((await db.query<{ id: string; name: string }>(`select id,name from public.pizza_styles`)).rows.map((r) => [r.name, r.id]))
  const ing = (await db.query<{ id: string }>(`select id from public.pizza_ingredients where active order by sort_order,name limit 2`)).rows.map((r) => r.id)
  const ex = (await db.query<{ id: string }>(`select id from public.pizza_extras where active order by sort_order limit 1`)).rows[0].id
  const configs = [
    { size: 'grande', portions: [P(S['Estilo Mexicana'], { chiles: ['jalapeno', 'morron'] }), P(S['Estilo Mexicana'], { chiles: ['serrano'] })], extra_ids: [ex] },
    { size: 'grande', portions: [P(S['Estilo Varas'], { extra_ingredient_ids: [ing[0], ing[0]] }), P(S["Estilo Chuy's"], { extra_ingredient_ids: [ing[1]] })], extra_ids: [] },
    { size: 'grande', portions: [P(S['Estilo Mexicana'], { chile: 'morron', extra_cheese: true, extra_ids: [ex] }), P(S["Estilo Chuy's"], { extra_ids: [ex] })] },
  ]
  const snap = async () => {
    await asSuperuser(db)
    const o = []
    for (const c of configs) {
      const v = await rpc('public.validate_pizza($1::jsonb)', [JSON.stringify(c)])
      o.push([v, await rpc('public.describe_pizza($1::jsonb)', [JSON.stringify(v)]), await rpc('public.price_pizza($1::jsonb)', [JSON.stringify(v)])])
    }
    return o
  }
  const before = await snap()
  const cashier = await createProfile(db, { role: 'cashier', fullName: 'C' })
  await asUser(db, cashier)
  await rpc('public.open_cash_session($1)', [0])
  for (let i = 0; i < configs.length; i++) {
    await asUser(db, cashier)
    const id = (await rpc('public.create_order($1,$2,$3::jsonb,$4)', [null, `C${i}`, JSON.stringify([{ type: 'pizza', quantity: 1, pizza: configs[i], notes: null }]), null])).order_id
    await rpc('public.pay_order($1,$2)', [id, 99_999_999])
  }
  const inflight = (await rpc('public.create_order($1,$2,$3::jsonb,$4)', [1, null, JSON.stringify([{ type: 'pizza', quantity: 1, pizza: configs[2], notes: null }]), null])).order_id
  const state = async () => {
    await asSuperuser(db)
    return [(await db.query(`select public.kitchen_line_json(i) r from public.order_items i order by i.created_at,i.id`)).rows, await rpc('public.popular_picks(16)')]
  }
  const s1 = await state()
  const h1 = await hash()

  await applyMigration(db, '20261201120000_pizza_portion_notes.sql')
  await applyMigration(db, '20261202120000_pizza_note_shortcuts.sql')

  expect(await hash()).toBe(h1)
  expect(await snap()).toEqual(before)
  expect(await state()).toEqual(s1)
  await asUser(db, cashier)
  await rpc('public.add_order_items($1,$2::jsonb)', [
    inflight,
    JSON.stringify([{ type: 'pizza', quantity: 1, pizza: { ...configs[0], portions: configs[0].portions.map((p) => ({ ...p, note: 'z'.repeat(80) })) }, notes: null }]),
  ])
  await rpc('public.pay_order($1,$2)', [inflight, 99_999_999])
}, 120_000)

it('a rejected portion note leaves every table byte-identical on every entry path', async () => {
  db = await createTestDb()
  await loadFixture(db)
  const S = Object.fromEntries((await db.query<{ id: string; name: string }>(`select id,name from public.pizza_styles`)).rows.map((r) => [r.name, r.id]))
  const admin = await createProfile(db, { role: 'admin', fullName: 'A' })
  const cashier = await createProfile(db, { role: 'cashier', fullName: 'C' })
  await asUser(db, cashier)
  await rpc('public.open_cash_session($1)', [0])
  await asUser(db, admin)
  const waiterId = (await rpc('public.admin_create_waiter($1,$2)', ['Luis', '1234'])).waiter_id
  const secret = (await rpc('public.admin_register_device($1)', ['Tablet'])).device_secret
  await asAnon(db)
  const shift = (await rpc('public.device_start_shift($1,$2,$3)', [secret, waiterId, '1234'])).token
  const item = (note: unknown) =>
    JSON.stringify([{ type: 'pizza', quantity: 1, notes: null, pizza: { size: 'grande', portions: [P(S['Estilo Varas'], { note }), P(S["Estilo Chuy's"])], extra_ids: [] } }])
  await asUser(db, cashier)
  const open = (await rpc('public.create_order($1,$2,$3::jsonb,$4)', [1, null, item('ok'), null])).order_id
  await asAnon(db)
  const dopen = (await rpc('public.device_create_order($1,$2,$3,$4,$5::jsonb)', [secret, shift, 2, null, item('ok')])).order_id
  const h0 = await hash()
  for (const [note, msg] of [
    ['a'.repeat(81), 'La nota de cada porción admite hasta 80 caracteres.'],
    [5, 'La configuración de la pizza es inválida.'],
  ] as const) {
    await asUser(db, cashier)
    await expect(rpc('public.create_order($1,$2,$3::jsonb,$4)', [9, null, item(note), null])).rejects.toThrow(msg)
    await expect(rpc('public.add_order_items($1,$2::jsonb)', [open, item(note)])).rejects.toThrow(msg)
    await asAnon(db)
    await expect(rpc('public.device_create_order($1,$2,$3,$4,$5::jsonb)', [secret, shift, 8, null, item(note)])).rejects.toThrow(msg)
    await expect(rpc('public.device_add_order_items($1,$2,$3,$4::jsonb)', [secret, shift, dopen, item(note)])).rejects.toThrow(msg)
    expect(await hash()).toBe(h0)
  }
}, 120_000)
