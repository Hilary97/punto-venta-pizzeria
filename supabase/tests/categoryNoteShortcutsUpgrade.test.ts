// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
// Diagnostic output of the verification probes; the assertions below carry the checks.
const log = (..._a: unknown[]) => {}
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { afterEach, describe, expect, it } from 'vitest'
import { applyMigration, asAnon, asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

const NEW = '20261203120000_category_note_shortcuts.sql'
const ZERO = '00000000-0000-0000-0000-000000000000'
let db: TestDb
const dbs: TestDb[] = []
afterEach(async () => { for (const d of dbs.splice(0)) await d.close() })

async function q(d: TestDb, sql: string, p: unknown[] = []) { return (await d.query<any>(sql, p)).rows }
async function rpcOn(d: TestDb, sql: string, p: unknown[] = []): Promise<any> { return (await d.query<any>(`select ${sql} as r`, p)).rows[0].r }
async function errOn(_d: TestDb, fn: () => Promise<unknown>) { try { await fn(); return 'NO ERROR' } catch (e) { return (e as Error).message } }
async function hash(d: TestDb) { await asSuperuser(d); return (await q(d, `select md5(coalesce(string_agg(t::text,'|' order by t.id),'')) h from public.pizza_note_shortcuts t`))[0].h }

async function setup(d: TestDb) {
  await loadFixture(d)
  const admin = await createProfile(d, { role: 'admin', fullName: 'A' })
  const cashier = await createProfile(d, { role: 'cashier', fullName: 'C' })
  const waiter = await createProfile(d, { role: 'waiter', fullName: 'W' })
  const kitchen = (await q(d, `select 1`)) && null
  return { admin, cashier, waiter, kitchen }
}

// Mirrors the Supabase hosted defaults: objects created by postgres in public are granted to anon/authenticated.
const SUPABASE_DEFAULTS = `
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
`
async function supabaseLikeDb(before?: string): Promise<TestDb> {
  const src = readFileSync(join(import.meta.dirname, 'db.ts'), 'utf8')
  const boot = src.slice(src.indexOf('const BOOTSTRAP_SQL = `') + 'const BOOTSTRAP_SQL = `'.length)
  const bootstrap = boot.slice(0, boot.indexOf('`'))
  const d = new PGlite({ extensions: { pgcrypto } })
  await d.exec(bootstrap)
  await d.exec(SUPABASE_DEFAULTS)
  const files = readdirSync(join(import.meta.dirname, '..', 'migrations')).filter((f) => f.endsWith('.sql')).filter((f) => before === undefined || f < before).sort()
  for (const f of files) await applyMigration(d, f)
  return d
}

/** Same scripted pizza/order session on any DB; returns every observable output. */
async function script(d: TestDb, admin: string, cashier: string) {
  const out: unknown[] = []
  const add = async (scope: unknown, label: unknown) => { await asUser(d, admin); return errOn(d, async () => out.push(['add', scope, label, typeof (await rpcOn(d, 'public.admin_add_note_shortcut($1,$2)', [scope, label])).id])) }
  const list = async (scope: string) => { await asUser(d, admin); return (await rpcOn(d, 'public.admin_list_note_shortcuts($1)', [scope])) as Array<{ id: string; label: string }> }
  for (const [sc, l] of [['pizza', 'Bien cocida'], ['pizza', 'Sin cebolla'], ['order', 'Cubiertos'], ['pizza', 'Sin chile'], ['order', 'Pagan con $500'], ['pizza', 'sin CEBOLLA'], ['order', ''], ['category', 'X'], [null, 'X'], ['pizza', 'x'.repeat(41)]] as const) out.push(await add(sc, l))
  const idOf = async (scope: string, label: string) => (await list(scope)).find((r) => r.label === label)!.id
  const move = async (id: unknown, dir: unknown) => { await asUser(d, admin); out.push(['move', dir, await errOn(d, () => rpcOn(d, 'public.admin_move_note_shortcut($1,$2)', [id, dir]))]) }
  await move(await idOf('pizza', 'Sin chile'), -1)
  await move(await idOf('pizza', 'Sin chile'), -1)
  await move(await idOf('pizza', 'Sin chile'), -1) // stays at top
  await move(await idOf('order', 'Pagan con $500'), 1) // stays at bottom
  await move(await idOf('order', 'Cubiertos'), 1)
  await move(await idOf('pizza', 'Bien cocida'), 0)
  await move(await idOf('pizza', 'Bien cocida'), null)
  await move(await idOf('pizza', 'Bien cocida'), 2)
  await move(ZERO, 1)
  await move(null, 1)
  await asUser(d, admin)
  out.push(['del-unknown', await errOn(d, () => rpcOn(d, 'public.admin_delete_note_shortcut($1)', [ZERO]))])
  out.push(['del-null', await errOn(d, () => rpcOn(d, 'public.admin_delete_note_shortcut($1)', [null]))])
  for (const u of [cashier]) { await asUser(d, u); out.push(['cashier-move', await errOn(d, () => rpcOn(d, 'public.admin_move_note_shortcut($1,$2)', [ZERO, 1]))]) }
  await asAnon(d); out.push(['anon-move', await errOn(d, () => rpcOn(d, 'public.admin_move_note_shortcut($1,$2)', [ZERO, 1]))])
  const del = await idOf('pizza', 'Sin cebolla')
  await asUser(d, admin); await rpcOn(d, 'public.admin_delete_note_shortcut($1)', [del])
  out.push(['pizza', (await list('pizza')).map((r) => r.label)], ['order', (await list('order')).map((r) => r.label)])
  await asSuperuser(d)
  out.push(['sort', await q(d, `select scope, label, sort_order from public.pizza_note_shortcuts where scope in ('pizza','order') order by scope, sort_order`)])
  await asUser(d, cashier)
  out.push(['read', await rpcOn(d, 'public.list_note_shortcuts()')])
  return out
}

describe('V1 upgrade from production baseline', () => {
  it('keeps existing pizza/order rows, order and read output (plus categories {})', async () => {
    db = await createTestDb({ before: '20261203120000' }); dbs.push(db)
    const { admin, cashier } = await setup(db)
    for (const [sc, l] of [['pizza', 'Bien cocida'], ['pizza', 'Sin cebolla'], ['order', 'Cubiertos'], ['order', 'Pagan con $500'], ['pizza', 'Sin chile']]) { await asUser(db, admin); await rpcOn(db, 'public.admin_add_note_shortcut($1,$2)', [sc, l]) }
    await asUser(db, admin)
    const chile = (await rpcOn(db, `public.admin_list_note_shortcuts('pizza')`)).at(-1).id
    await rpcOn(db, 'public.admin_move_note_shortcut($1,-1)', [chile])
    const w = await (async () => { await asUser(db, admin); return rpcOn(db, `public.admin_register_device('T','waiter')`) })()
    await asSuperuser(db)
    const rowsBefore = await q(db, `select id, scope, label, sort_order, created_at from public.pizza_note_shortcuts order by id`)
    await asUser(db, cashier); const readBefore = await rpcOn(db, 'public.list_note_shortcuts()')
    await asAnon(db); const devBefore = await rpcOn(db, 'public.device_list_note_shortcuts($1)', [w.device_secret])
    await asUser(db, admin); const adminBefore = [await rpcOn(db, `public.admin_list_note_shortcuts('pizza')`), await rpcOn(db, `public.admin_list_note_shortcuts('order')`)]
    await asSuperuser(db)
    await applyMigration(db, NEW)
    const rowsAfter = await q(db, `select id, scope, label, sort_order, created_at, category_id from public.pizza_note_shortcuts order by id`)
    expect(rowsAfter).toEqual(rowsBefore.map((r: any) => ({ ...r, category_id: null })))
    await asUser(db, cashier); expect(await rpcOn(db, 'public.list_note_shortcuts()')).toStrictEqual({ ...readBefore, categories: {} })
    await asAnon(db); expect(await rpcOn(db, 'public.device_list_note_shortcuts($1)', [w.device_secret])).toStrictEqual({ ...devBefore, categories: {} })
    await asUser(db, admin); expect([await rpcOn(db, `public.admin_list_note_shortcuts('pizza')`), await rpcOn(db, `public.admin_list_note_shortcuts('order')`)]).toStrictEqual(adminBefore)
    // migration idempotent re-run?
    await asSuperuser(db)
    log('V1 rerun:', await errOn(db, () => applyMigration(db, NEW)))
  }, 60_000)

  it('pizza/order add/move/delete behave exactly as the previous definitions', async () => {
    const base = await createTestDb({ before: '20261203120000' }); dbs.push(base)
    const cand = await createTestDb(); dbs.push(cand)
    const a = await setup(base); const b = await setup(cand)
    // category rows interleaved in the candidate must not change pizza/order behavior
    await asSuperuser(cand)
    const cat = (await q(cand, `select id from public.categories limit 1`))[0].id
    await asUser(cand, b.admin); await rpcOn(cand, 'public.admin_add_category_note_shortcut($1,$2)', [cat, 'Bien cocida'])
    const outBase = await script(base, a.admin, a.cashier)
    const outCand = await script(cand, b.admin, b.cashier)
    const last = outCand.pop() as any; const lastBase = outBase.pop() as any
    expect(last[1]).toStrictEqual({ ...lastBase[1], categories: { [cat]: ['Bien cocida'] } })
    expect(outCand).toStrictEqual(outBase)
    log('V1 script:', JSON.stringify(outBase))
  }, 60_000)

  it('unique index keeps the old rule and adds per-category uniqueness', async () => {
    db = await createTestDb(); dbs.push(db)
    await setup(db)
    await asSuperuser(db)
    const [c1, c2] = (await q(db, `insert into public.categories (name, sort_order) values ('H',2),('B',3) returning id`)).map((r: any) => r.id)
    const ins = (scope: string, label: string, cat: string | null, so = 1) => errOn(db, () => db.query(`insert into public.pizza_note_shortcuts (scope, label, category_id, sort_order) values ($1,$2,$3,$4)`, [scope, label, cat, so]))
    const res = {
      p1: await ins('pizza', 'Sin cebolla', null), pDup: await ins('pizza', 'SIN CEBOLLA', null),
      o1: await ins('order', 'Sin cebolla', null), oDup: await ins('order', 'sin cebolla', null),
      c1: await ins('category', 'Sin cebolla', c1), c1Dup: await ins('category', 'sin Cebolla', c1),
      c2: await ins('category', 'SIN CEBOLLA', c2),
      catNull: await ins('category', 'Z', null), pizzaWithCat: await ins('pizza', 'Z', c1), badScope: await ins('kitchen', 'Z', null),
      unknownCat: await ins('category', 'Z', ZERO), untrimmed: await ins('category', ' Z', c1),
    }
    log('V1 index:', JSON.stringify(res))
    expect(res.p1).toBe('NO ERROR'); expect(res.o1).toBe('NO ERROR'); expect(res.c1).toBe('NO ERROR'); expect(res.c2).toBe('NO ERROR')
    for (const k of ['pDup', 'oDup', 'c1Dup'] as const) expect(res[k]).toMatch(/duplicate key/)
    for (const k of ['catNull', 'pizzaWithCat', 'badScope', 'unknownCat', 'untrimmed'] as const) expect(res[k]).not.toBe('NO ERROR')
    const idx = await q(db, `select indexname, indexdef from pg_indexes where tablename='pizza_note_shortcuts' order by 1`)
    log('V1 indexes:', JSON.stringify(idx))
    expect(idx.map((r: any) => r.indexname)).toEqual(['pizza_note_shortcuts_list_label_key', 'pizza_note_shortcuts_pkey'])
  }, 60_000)

  it('grants under Supabase-like default privileges (fresh and upgrade)', async () => {
    for (const mode of ['fresh', 'upgrade'] as const) {
      const d = mode === 'fresh' ? await supabaseLikeDb() : await supabaseLikeDb('20261203120000'); dbs.push(d)
      if (mode === 'upgrade') await applyMigration(d, NEW)
      const t = await q(d, `select r, has_table_privilege(r, 'public.pizza_note_shortcuts', 'select,insert,update,delete,truncate,references,trigger') any_priv,
         has_column_privilege(r, 'public.pizza_note_shortcuts', 'category_id', 'select,insert,update,references') col
         from unnest(array['anon','authenticated']) r`)
      const f = await q(d, `select p.proname, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth, p.prosecdef, p.proconfig
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%note_shortcut%' order by 1`)
      log(`V1 grants ${mode}:`, JSON.stringify(t), JSON.stringify(f))
      expect(t.every((r: any) => !r.any_priv && !r.col)).toBe(true)
      expect(Object.fromEntries(f.map((x: any) => [x.proname, [x.anon, x.auth, x.prosecdef, x.proconfig]]))).toEqual({
        admin_add_category_note_shortcut: [false, true, true, ['search_path=public']],
        admin_add_note_shortcut: [false, true, true, ['search_path=public']],
        admin_delete_note_shortcut: [false, true, true, ['search_path=public']],
        admin_list_category_note_shortcuts: [false, true, true, ['search_path=public']],
        admin_list_note_shortcuts: [false, true, true, ['search_path=public']],
        admin_move_note_shortcut: [false, true, true, ['search_path=public']],
        device_list_note_shortcuts: [true, true, true, ['search_path=public']],
        list_note_shortcuts: [false, true, true, ['search_path=public']],
        note_shortcut_labels: [false, false, true, ['search_path=public']],
      })
    }
  }, 120_000)
})

describe('V2 category rules', () => {
  async function fresh() {
    db = await createTestDb(); dbs.push(db)
    const u = await setup(db)
    await asSuperuser(db)
    const [burgers, drinks] = (await q(db, `insert into public.categories (name, sort_order) values ('Hamburguesas',2),('Bebidas preparadas',3) returning id`)).map((r: any) => r.id)
    const add = async (c: unknown, l: unknown) => { await asUser(db, u.admin); return rpcOn(db, 'public.admin_add_category_note_shortcut($1,$2)', [c, l]) }
    const tryAdd = async (c: unknown, l: unknown, who = u.admin) => { await asUser(db, who); return errOn(db, () => rpcOn(db, 'public.admin_add_category_note_shortcut($1,$2)', [c, l])) }
    const list = async (c: unknown) => { await asUser(db, u.admin); return rpcOn(db, 'public.admin_list_category_note_shortcuts($1)', [c]) }
    return { ...u, burgers, drinks, add, tryAdd, list }
  }

  it('exact messages; every rejection leaves the table byte-identical', async () => {
    const f = await fresh()
    for (let i = 1; i <= 11; i++) await f.add(f.burgers, `B${i}`)
    await f.add(f.burgers, ' ' + 'z'.repeat(40) + ' ') // 12th, exactly 40 after trim
    await f.add(f.drinks, 'Sin hielo')
    const before = await hash(db)
    const res: Record<string, string> = {
      cap: await f.tryAdd(f.burgers, 'B13'),
      dupCase: await f.tryAdd(f.drinks, '  SIN HIELO '),
      blank: await f.tryAdd(f.drinks, '   '), empty: await f.tryAdd(f.drinks, ''), nul: await f.tryAdd(f.drinks, null),
      long: await f.tryAdd(f.drinks, 'y'.repeat(41)),
      unknownCat: await f.tryAdd(ZERO, 'X'), nullCat: await f.tryAdd(null, 'X'),
      cashier: await f.tryAdd(f.drinks, 'X', f.cashier), waiter: await f.tryAdd(f.drinks, 'X', f.waiter), noProfile: await f.tryAdd(f.drinks, 'X', crypto.randomUUID()),
    }
    await asAnon(db); res.anon = await errOn(db, () => rpcOn(db, 'public.admin_add_category_note_shortcut($1,$2)', [f.drinks, 'X']))
    await asAnon(db); res.anonList = await errOn(db, () => rpcOn(db, 'public.admin_list_category_note_shortcuts($1)', [f.drinks]))
    await asUser(db, f.cashier); res.cashierList = await errOn(db, () => rpcOn(db, 'public.admin_list_category_note_shortcuts($1)', [f.drinks]))
    const drinkId = (await f.list(f.drinks))[0].id
    for (const dir of [0, 2, null]) { await asUser(db, f.admin); res[`dir${dir}`] = await errOn(db, () => rpcOn(db, 'public.admin_move_note_shortcut($1,$2)', [drinkId, dir])) }
    await asUser(db, f.waiter); res.waiterMove = await errOn(db, () => rpcOn(db, 'public.admin_move_note_shortcut($1,$2)', [drinkId, -1]))
    await asUser(db, f.cashier); res.cashierDel = await errOn(db, () => rpcOn(db, 'public.admin_delete_note_shortcut($1)', [drinkId]))
    await asAnon(db); res.anonDel = await errOn(db, () => rpcOn(db, 'public.admin_delete_note_shortcut($1)', [drinkId]))
    await asUser(db, f.admin); res.moveUnknown = await errOn(db, () => rpcOn(db, 'public.admin_move_note_shortcut($1,$2)', [ZERO, 1]))
    await asUser(db, f.admin); res.scopedCategory = await errOn(db, () => rpcOn(db, 'public.admin_add_note_shortcut($1,$2)', ['category', 'X']))
    log('V2 messages:', JSON.stringify(res, null, 1))
    expect(await hash(db)).toBe(before)
    expect(res).toMatchObject({
      cap: expect.stringContaining('Puedes tener hasta 12 atajos por categoría.'),
      dupCase: expect.stringContaining('Ese atajo ya existe.'),
      blank: expect.stringContaining('Escribe el texto del atajo.'), empty: expect.stringContaining('Escribe el texto del atajo.'), nul: expect.stringContaining('Escribe el texto del atajo.'),
      long: expect.stringContaining('El atajo admite hasta 40 caracteres.'),
      unknownCat: expect.stringContaining('Esa categoría ya no existe.'), nullCat: expect.stringContaining('Esa categoría ya no existe.'),
      cashier: expect.stringContaining('Solo un administrador'), waiter: expect.stringContaining('Solo un administrador'), noProfile: expect.stringContaining('Solo un administrador'),
      anon: expect.stringContaining('permission denied'), anonList: expect.stringContaining('permission denied'), cashierList: expect.stringContaining('Solo un administrador'),
      dir0: expect.stringContaining('Dirección inválida.'), dir2: expect.stringContaining('Dirección inválida.'), dirnull: expect.stringContaining('Dirección inválida.'),
      waiterMove: expect.stringContaining('Solo un administrador'), cashierDel: expect.stringContaining('Solo un administrador'), anonDel: expect.stringContaining('permission denied'),
      moveUnknown: expect.stringContaining('Ese atajo ya no está en la lista.'), scopedCategory: expect.stringContaining('Lista de atajos inválida.'),
    })
    expect(await f.list(f.burgers)).toHaveLength(12)
  }, 60_000)

  it('moves in one category never touch other lists bytes; cross-list neighbours are skipped', async () => {
    const f = await fresh()
    await asUser(db, f.admin); await rpcOn(db, `public.admin_add_note_shortcut('pizza','P1')`)
    const b1 = (await f.add(f.burgers, 'B1')).id
    await f.add(f.drinks, 'D1')
    const b2 = (await f.add(f.burgers, 'B2')).id
    await asUser(db, f.admin); await rpcOn(db, `public.admin_add_note_shortcut('order','O1')`)
    await f.add(f.drinks, 'D2')
    await asSuperuser(db)
    const others = async () => { await asSuperuser(db); return JSON.stringify(await q(db, `select * from public.pizza_note_shortcuts where category_id is distinct from $1 order by id`, [f.burgers])) }
    const o = await others()
    await asUser(db, f.admin); await rpcOn(db, 'public.admin_move_note_shortcut($1,1)', [b1])
    expect((await f.list(f.burgers)).map((r: any) => r.label)).toEqual(['B2', 'B1'])
    await asUser(db, f.admin); await rpcOn(db, 'public.admin_move_note_shortcut($1,1)', [b1]) // end: stays
    await asUser(db, f.admin); await rpcOn(db, 'public.admin_move_note_shortcut($1,-1)', [b2]) // top: stays
    expect((await f.list(f.burgers)).map((r: any) => r.label)).toEqual(['B2', 'B1'])
    expect(await others()).toBe(o)
    // delete by id of a category row removes only that row
    await asUser(db, f.admin); await rpcOn(db, 'public.admin_delete_note_shortcut($1)', [b2])
    expect(await others()).toBe(o)
    expect((await f.list(f.burgers)).map((r: any) => r.label)).toEqual(['B1'])
    // new add goes to the end after max(sort_order)
    await f.add(f.burgers, 'B3')
    expect((await f.list(f.burgers)).map((r: any) => r.label)).toEqual(['B1', 'B3'])
  }, 60_000)

  it('cascade on category delete, other lists intact; reads drop the category', async () => {
    const f = await fresh()
    await f.add(f.burgers, 'B1'); await f.add(f.drinks, 'D1')
    await asUser(db, f.admin); await rpcOn(db, `public.admin_add_note_shortcut('order','O1')`)
    await asSuperuser(db); await db.query('delete from public.categories where id=$1', [f.burgers])
    await asUser(db, f.cashier)
    expect(await rpcOn(db, 'public.list_note_shortcuts()')).toStrictEqual({ pizza: [], order: ['O1'], categories: { [f.drinks]: ['D1'] } })
    await asUser(db, f.admin)
    expect(await errOn(db, () => rpcOn(db, 'public.admin_list_category_note_shortcuts($1)', [f.burgers]))).toContain('Esa categoría ya no existe.')
  }, 60_000)

  it('reads: labels only per category for admin/cashier/waiter device; others rejected', async () => {
    const f = await fresh()
    await f.add(f.burgers, 'Sin pepinillos'); await f.add(f.burgers, 'Término medio'); await f.add(f.drinks, 'Sin hielo')
    const burgersSecond = (await f.list(f.burgers))[1].id
    await asUser(db, f.admin); await rpcOn(db, 'public.admin_move_note_shortcut($1,-1)', [burgersSecond])
    const expected = { pizza: [], order: [], categories: { [f.burgers]: ['Término medio', 'Sin pepinillos'], [f.drinks]: ['Sin hielo'] } }
    for (const u of [f.admin, f.cashier]) { await asUser(db, u); expect(await rpcOn(db, 'public.list_note_shortcuts()')).toStrictEqual(expected) }
    const reg = async (kind: string) => { await asUser(db, f.admin); return rpcOn(db, 'public.admin_register_device($1,$2)', ['T', kind]) }
    const w = await reg('waiter'); const rv = await reg('waiter'); const kp = await reg('kitchen_pizza'); const kg = await reg('kitchen_grill')
    await asUser(db, f.admin); await rpcOn(db, 'public.admin_revoke_device($1)', [rv.device_id])
    await asAnon(db); expect(await rpcOn(db, 'public.device_list_note_shortcuts($1)', [w.device_secret])).toStrictEqual(expected)
    await asUser(db, f.waiter); expect(await rpcOn(db, 'public.device_list_note_shortcuts($1)', [w.device_secret])).toStrictEqual(expected)
    const out: Record<string, string> = {}
    await asUser(db, f.waiter); out.waiterList = await errOn(db, () => rpcOn(db, 'public.list_note_shortcuts()'))
    await asAnon(db); out.anonList = await errOn(db, () => rpcOn(db, 'public.list_note_shortcuts()'))
    for (const [n, sec] of [['unknown', 'nope'], ['empty', ''], ['null', null], ['revoked', rv.device_secret], ['kp', kp.device_secret], ['kg', kg.device_secret]] as const) { await asAnon(db); out[n] = await errOn(db, () => rpcOn(db, 'public.device_list_note_shortcuts($1)', [sec])) }
    for (const u of [f.admin, f.cashier]) { await asUser(db, u); out['helper' + u.slice(0, 4)] = await errOn(db, () => rpcOn(db, 'public.note_shortcut_labels()')) }
    await asAnon(db); out.helperAnon = await errOn(db, () => rpcOn(db, 'public.note_shortcut_labels()'))
    log('V2 reads:', JSON.stringify(out, null, 1))
    expect(out.waiterList).toContain('No tienes permiso')
    expect(out.anonList).not.toBe('NO ERROR')
    for (const k of ['unknown', 'empty', 'null', 'revoked']) expect(out[k]).toContain('no está autorizado')
    for (const k of ['kp', 'kg']) expect(out[k]).not.toBe('NO ERROR')
    for (const [k, v] of Object.entries(out)) if (k.startsWith('helper')) expect(v).toContain('permission denied')
  }, 60_000)
})
