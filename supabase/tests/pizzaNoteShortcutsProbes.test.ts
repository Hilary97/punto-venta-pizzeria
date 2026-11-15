// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyMigration, asAnon, asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

let db: TestDb
let admin: string, cashier: string, waiter: string, noProfile: string

async function rpc(sql: string, params: unknown[] = []): Promise<any> {
  const res = await db.query<{ r: any }>(`select ${sql} as r`, params)
  return res.rows[0].r
}
async function snap(): Promise<string> {
  await asSuperuser(db)
  const r = await db.query<{ h: string }>(
    `select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as h from public.pizza_note_shortcuts t`)
  return r.rows[0].h
}
async function rows(scope: string) {
  await asSuperuser(db)
  return (await db.query<any>(`select id, label, sort_order from public.pizza_note_shortcuts where scope=$1 order by sort_order, created_at`, [scope])).rows
}
async function add(label: string, scope = 'pizza'): Promise<string> {
  await asUser(db, admin)
  return (await rpc('public.admin_add_note_shortcut($1, $2)', [scope, label])).id
}
async function errOf(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return 'NO ERROR' } catch (e) { return (e as Error).message }
}
async function dev(kind: string) {
  await asUser(db, admin)
  return rpc('public.admin_register_device($1, $2)', ['T', kind])
}

beforeEach(async () => {
  db = await createTestDb()
  await loadFixture(db)
  admin = await createProfile(db, { role: 'admin', fullName: 'A' })
  cashier = await createProfile(db, { role: 'cashier', fullName: 'C' })
  waiter = await createProfile(db, { role: 'waiter', fullName: 'W' })
  noProfile = crypto.randomUUID()
}, 60_000)
afterEach(async () => { await db.close() })

describe('verifier probes', () => {
  it('P1 rejected adds leave the table byte-identical with exact messages', async () => {
    await add('Sin cebolla'); await add('Cubiertos', 'order')
    const before = await snap()
    const cases: Array<[unknown, unknown, string]> = [
      ['pizza', '', 'Escribe el texto del atajo.'],
      ['pizza', '    ', 'Escribe el texto del atajo.'],
      ['order', null, 'Escribe el texto del atajo.'],
      ['pizza', 'x'.repeat(41), 'El atajo admite hasta 40 caracteres.'],
      ['order', ' ' + 'y'.repeat(41) + ' ', 'El atajo admite hasta 40 caracteres.'],
      ['pizza', '  sin CEBOLLA ', 'Ese atajo ya existe.'],
      ['order', 'CUBIERTOS', 'Ese atajo ya existe.'],
      ['Pizza', 'X', 'Lista de atajos inválida.'],
      [' order', 'X', 'Lista de atajos inválida.'],
      ['kitchen', 'X', 'Lista de atajos inválida.'],
      ['', 'X', 'Lista de atajos inválida.'],
      [null, 'X', 'Lista de atajos inválida.'],
    ]
    const got: string[] = []
    for (const [scope, label, msg] of cases) {
      await asUser(db, admin)
      const m = await errOf(() => rpc('public.admin_add_note_shortcut($1, $2)', [scope, label]))
      got.push(`${JSON.stringify([scope, label])} -> ${m}`)
      expect(m, JSON.stringify([scope, label])).toContain(msg)
    }
    console.log(got.join('\n'))
    expect(await snap()).toBe(before)
  })

  it('P2 boundary: 40 chars after trim accepted, stored trimmed', async () => {
    await add('  ' + 'z'.repeat(40) + '  ', 'order')
    expect((await rows('order')).map((r) => r.label)).toEqual(['z'.repeat(40)])
  })

  it('P3 cap: 12 per scope independently; rejection byte-identical', async () => {
    for (let i = 1; i <= 12; i++) await add(`P${i}`)
    for (let i = 1; i <= 12; i++) await add(`O${i}`, 'order')
    const before = await snap()
    await asUser(db, admin)
    expect(await errOf(() => rpc('public.admin_add_note_shortcut($1,$2)', ['pizza', 'P13']))).toContain('Puedes tener hasta 12 atajos de notas.')
    expect(await errOf(() => rpc('public.admin_add_note_shortcut($1,$2)', ['order', 'O13']))).toContain('Puedes tener hasta 12 atajos de nota del pedido.')
    expect(await snap()).toBe(before)
    // deleting one pizza frees one pizza slot only
    const p1 = (await rows('pizza'))[0].id
    await asUser(db, admin)
    await rpc('public.admin_delete_note_shortcut($1)', [p1])
    expect(await errOf(() => rpc('public.admin_add_note_shortcut($1,$2)', ['order', 'O13']))).toContain('hasta 12')
    await add('P13')
    expect((await rows('pizza')).length).toBe(12)
  })

  it('P4 move/delete never touch the other scope (rows byte-identical)', async () => {
    await add('P1'); const o1 = await add('O1', 'order'); await add('P2'); const o2 = await add('O2', 'order'); await add('P3')
    const pizzaBefore = JSON.stringify(await rows('pizza'))
    await asUser(db, admin)
    await rpc('public.admin_move_note_shortcut($1,$2)', [o1, 1])
    await rpc('public.admin_move_note_shortcut($1,$2)', [o1, 1])
    expect((await rows('order')).map((r) => r.label)).toEqual(['O2', 'O1'])
    await asUser(db, admin)
    await rpc('public.admin_move_note_shortcut($1,$2)', [o1, -1])
    expect((await rows('order')).map((r) => r.label)).toEqual(['O1', 'O2'])
    await asUser(db, admin)
    await rpc('public.admin_delete_note_shortcut($1)', [o2])
    expect(JSON.stringify(await rows('pizza'))).toBe(pizzaBefore)
    // pizza move at end with order rows interleaved in sort_order
    const orderBefore = JSON.stringify(await rows('order'))
    const p3 = (await rows('pizza'))[2].id
    await asUser(db, admin)
    await rpc('public.admin_move_note_shortcut($1,$2)', [p3, 1])
    await rpc('public.admin_move_note_shortcut($1,$2)', [p3, -1])
    expect((await rows('pizza')).map((r) => r.label)).toEqual(['P1', 'P3', 'P2'])
    expect(JSON.stringify(await rows('order'))).toBe(orderBefore)
  })

  it('P5 bad move inputs rejected byte-identical', async () => {
    const a = await add('A'); await add('B')
    const before = await snap()
    await asUser(db, admin)
    const out: string[] = []
    for (const [id, d] of [[a, 0], [a, null], [a, 2], [a, -2], ['00000000-0000-0000-0000-000000000000', 1], [null, 1]] as const) {
      await asUser(db, admin)
      out.push(`${id}/${d} -> ${await errOf(() => rpc('public.admin_move_note_shortcut($1,$2)', [id, d]))}`)
    }
    console.log(out.join('\n'))
    expect(out.every((l) => !l.endsWith('NO ERROR'))).toBe(true)
    expect(await snap()).toBe(before)
  })

  it('P6 admin writes denied for anon/cashier/waiter/no-profile; byte-identical', async () => {
    const id = await add('A'); await add('Z', 'order')
    const before = await snap()
    const calls: Array<[string, unknown[]]> = [
      ['public.admin_list_note_shortcuts($1)', ['order']],
      ['public.admin_add_note_shortcut($1, $2)', ['order', 'B']],
      ['public.admin_delete_note_shortcut($1)', [id]],
      ['public.admin_move_note_shortcut($1, $2)', [id, 1]],
    ]
    const out: string[] = []
    for (const [sql, p] of calls) {
      await asAnon(db); out.push(`anon ${sql}: ${await errOf(() => rpc(sql, p))}`)
      for (const [n, u] of [['cashier', cashier], ['waiter', waiter], ['noprofile', noProfile]] as const) {
        await asUser(db, u); out.push(`${n} ${sql}: ${await errOf(() => rpc(sql, p))}`)
      }
    }
    console.log(out.join('\n'))
    expect(out.filter((l) => l.startsWith('anon')).every((l) => l.includes('permission denied'))).toBe(true)
    expect(out.filter((l) => !l.startsWith('anon')).every((l) => l.includes('Solo un administrador puede editar las pizzas.'))).toBe(true)
    expect(await snap()).toBe(before)
  })

  it('P7 direct table access denied for every client role and every verb', async () => {
    const id = await add('A')
    const stmts = [
      'select * from public.pizza_note_shortcuts',
      `insert into public.pizza_note_shortcuts (scope,label,sort_order) values ('order','x',1)`,
      `update public.pizza_note_shortcuts set label='h'`,
      `delete from public.pizza_note_shortcuts`,
      `truncate public.pizza_note_shortcuts`,
    ]
    const before = await snap()
    const out: string[] = []
    for (const who of ['anon', admin, cashier, waiter, noProfile]) {
      for (const st of stmts) {
        if (who === 'anon') await asAnon(db); else await asUser(db, who)
        out.push(`${who.slice(0, 6)} ${st.slice(0, 12)}: ${await errOf(() => db.query(st))}`)
      }
    }
    console.log(out.join('\n'))
    expect(out.every((l) => l.includes('permission denied'))).toBe(true)
    expect(await snap()).toBe(before)
    void id
  })

  it('P8 read rpcs: roles, devices, and output shape labels only', async () => {
    await add('Sin cebolla'); await add('Cubiertos', 'order'); await add('Entregar rápido', 'order')
    const expected = { pizza: ['Sin cebolla'], order: ['Cubiertos', 'Entregar rápido'] }
    for (const u of [admin, cashier]) { await asUser(db, u); expect(await rpc('public.list_note_shortcuts()')).toStrictEqual(expected) }
    const out: string[] = []
    await asUser(db, waiter); out.push('waiter list: ' + await errOf(() => rpc('public.list_note_shortcuts()')))
    await asUser(db, noProfile); out.push('noprofile list: ' + await errOf(() => rpc('public.list_note_shortcuts()')))
    await asAnon(db); out.push('anon list: ' + await errOf(() => rpc('public.list_note_shortcuts()')))
    for (const u of ['anon', admin, cashier]) {
      if (u === 'anon') await asAnon(db); else await asUser(db, u)
      out.push(`${u.slice(0, 6)} labels(): ` + await errOf(() => rpc('public.note_shortcut_labels()')))
    }
    const w = await dev('waiter'); const kp = await dev('kitchen_pizza'); const kg = await dev('kitchen_grill'); const rv = await dev('waiter')
    await asUser(db, admin); await rpc('public.admin_revoke_device($1)', [rv.device_id])
    await asAnon(db)
    const r = await rpc('public.device_list_note_shortcuts($1)', [w.device_secret])
    expect(r).toStrictEqual(expected)
    expect(Object.keys(r).sort()).toEqual(['order', 'pizza'])
    for (const [n, sec] of [['unknown', 'nope'], ['empty', ''], ['null', null], ['revoked', rv.device_secret], ['kitchen_pizza', kp.device_secret], ['kitchen_grill', kg.device_secret]] as const) {
      await asAnon(db); out.push(`device ${n}: ` + await errOf(() => rpc('public.device_list_note_shortcuts($1)', [sec])))
    }
    console.log(out.join('\n'))
    expect(out.find((l) => l.startsWith('waiter list'))).toContain('No tienes permiso')
    expect(out.filter((l) => l.includes('labels()')).every((l) => l.includes('permission denied'))).toBe(true)
    expect(out.filter((l) => l.startsWith('device')).every((l) => !l.endsWith('NO ERROR'))).toBe(true)
  })

  it('P9 grants/secdef under Supabase-like default privileges, applied on the production baseline', async () => {
    await db.close()
    db = await createTestDb({ before: '20261201120000' })
    await asSuperuser(db)
    await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant all on functions to anon, authenticated;`)
    await applyMigration(db, '20261201120000_pizza_portion_notes.sql')
    await applyMigration(db, '20261202120000_pizza_note_shortcuts.sql')
    const t = await db.query<any>(`select r, p, has_table_privilege(r, 'public.pizza_note_shortcuts', p) ok
      from unnest(array['anon','authenticated']) r, unnest(array['select','insert','update','delete','truncate','references','trigger']) p`)
    expect(t.rows.filter((x) => x.ok)).toEqual([])
    const f = await db.query<any>(`select p.proname, p.prosecdef, p.proconfig,
        has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like '%note_shortcut%' order by 1`)
    console.log(JSON.stringify(f.rows))
    const m = Object.fromEntries(f.rows.map((x) => [x.proname, [x.anon, x.auth, x.prosecdef]]))
    expect(m).toEqual({
      admin_add_note_shortcut: [false, true, true],
      admin_delete_note_shortcut: [false, true, true],
      admin_list_note_shortcuts: [false, true, true],
      admin_move_note_shortcut: [false, true, true],
      device_list_note_shortcuts: [true, true, true],
      list_note_shortcuts: [false, true, true],
      note_shortcut_labels: [false, false, true],
    })
    expect(f.rows.every((x) => JSON.stringify(x.proconfig).includes('search_path=public'))).toBe(true)
    const rls = await db.query<any>(`select relrowsecurity from pg_class where oid='public.pizza_note_shortcuts'::regclass`)
    expect(rls.rows[0].relrowsecurity).toBe(true)
  })

  it('P10 observations: tab/NBSP label, non-ASCII case dup', async () => {
    const out: string[] = []
    await asUser(db, admin)
    out.push('tab: ' + await errOf(() => rpc('public.admin_add_note_shortcut($1,$2)', ['pizza', '\t'])))
    await asUser(db, admin)
    out.push('nbsp: ' + await errOf(() => rpc('public.admin_add_note_shortcut($1,$2)', ['pizza', ' '])))
    await add('Más queso', 'order')
    await asUser(db, admin)
    out.push('MÁS QUESO: ' + await errOf(() => rpc('public.admin_add_note_shortcut($1,$2)', ['order', 'MÁS QUESO'])))
    console.log(out.join('\n'))
  })
})
