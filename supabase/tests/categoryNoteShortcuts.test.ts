// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

let db: TestDb
let admin: string
let cashier: string
let waiter: string
let burgers: string
let drinks: string

async function rpc(sql: string, params: unknown[] = []): Promise<any> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}
async function errOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    return 'NO ERROR'
  } catch (e) {
    return (e as Error).message
  }
}
async function add(categoryId: string, label: string): Promise<string> {
  await asUser(db, admin)
  return (await rpc('public.admin_add_category_note_shortcut($1, $2)', [categoryId, label])).id
}
async function addScoped(scope: string, label: string): Promise<string> {
  await asUser(db, admin)
  return (await rpc('public.admin_add_note_shortcut($1, $2)', [scope, label])).id
}
async function labels(categoryId: string): Promise<string[]> {
  await asUser(db, admin)
  return (await rpc('public.admin_list_category_note_shortcuts($1)', [categoryId])).map((r: Json) => r.label)
}
async function snap(): Promise<string> {
  await asSuperuser(db)
  const r = await db.query<{ h: string }>(
    `select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as h from public.pizza_note_shortcuts t`,
  )
  return r.rows[0].h
}
async function registerDevice(kind: string = 'waiter') {
  await asUser(db, admin)
  return rpc('public.admin_register_device($1, $2)', ['Tablet', kind])
}

beforeEach(async () => {
  db = await createTestDb()
  await loadFixture(db)
  await asSuperuser(db)
  admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  waiter = await createProfile(db, { role: 'waiter', fullName: 'Mesero' })
  burgers = (await db.query<{ id: string }>(`insert into public.categories (name, sort_order) values ('Hamburguesas', 2) returning id`)).rows[0].id
  drinks = (await db.query<{ id: string }>(`insert into public.categories (name, sort_order) values ('Bebidas preparadas', 3) returning id`)).rows[0].id
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('S2 admin category note shortcuts', () => {
  it('adds trimmed labels and lists id and label in order for that category only', async () => {
    const a = await add(burgers, '  Sin pepinillos  ')
    const b = await add(burgers, 'Término medio')
    await add(drinks, 'Sin hielo')
    await asUser(db, admin)
    expect(await rpc('public.admin_list_category_note_shortcuts($1)', [burgers])).toEqual([
      { id: a, label: 'Sin pepinillos' },
      { id: b, label: 'Término medio' },
    ])
    expect(await labels(drinks)).toEqual(['Sin hielo'])
  })

  it('rejects a duplicate in the same category ignoring case, leaving the table unchanged', async () => {
    await add(burgers, 'Sin cebolla')
    const before = await snap()
    await asUser(db, admin)
    expect(await errOf(() => rpc('public.admin_add_category_note_shortcut($1, $2)', [burgers, '  SIN CEBOLLA ']))).toContain('Ese atajo ya existe.')
    expect(await snap()).toBe(before)
  })

  it('allows the same label in another category, in the pizza list and in the order list', async () => {
    await add(burgers, 'Sin hielo')
    await add(drinks, 'SIN HIELO')
    await addScoped('pizza', 'Sin hielo')
    await addScoped('order', 'Sin hielo')
    expect(await labels(burgers)).toEqual(['Sin hielo'])
    expect(await labels(drinks)).toEqual(['SIN HIELO'])
  })

  it('rejects blank, null, over 40 chars; accepts exactly 40; rejections leave the table unchanged', async () => {
    await add(burgers, 'x'.repeat(40))
    const before = await snap()
    const cases: Array<[unknown, string]> = [
      ['', 'Escribe el texto del atajo.'],
      ['   ', 'Escribe el texto del atajo.'],
      [null, 'Escribe el texto del atajo.'],
      ['y'.repeat(41), 'El atajo admite hasta 40 caracteres.'],
    ]
    for (const [label, msg] of cases) {
      await asUser(db, admin)
      expect(await errOf(() => rpc('public.admin_add_category_note_shortcut($1, $2)', [burgers, label]))).toContain(msg)
    }
    expect(await snap()).toBe(before)
  })

  it('caps each category at 12 on its own with the category message', async () => {
    for (let i = 1; i <= 12; i++) await add(burgers, `Atajo ${i}`)
    const before = await snap()
    await asUser(db, admin)
    expect(await errOf(() => rpc('public.admin_add_category_note_shortcut($1, $2)', [burgers, 'Atajo 13']))).toContain(
      'Puedes tener hasta 12 atajos por categoría.',
    )
    expect(await snap()).toBe(before)
    await add(drinks, 'Sin hielo')
    await addScoped('pizza', 'P1')
    await addScoped('order', 'O1')
    expect(await labels(burgers)).toHaveLength(12)
    await asUser(db, admin)
    await rpc('public.admin_delete_note_shortcut($1)', [(await rpc('public.admin_list_category_note_shortcuts($1)', [burgers]))[0].id])
    await add(burgers, 'Atajo 13')
    expect(await labels(burgers)).toHaveLength(12)
  })

  it('rejects an unknown or missing category without changing anything', async () => {
    await add(burgers, 'A')
    const before = await snap()
    for (const id of ['00000000-0000-0000-0000-000000000000', crypto.randomUUID(), null]) {
      await asUser(db, admin)
      expect(await errOf(() => rpc('public.admin_add_category_note_shortcut($1, $2)', [id, 'X']))).toContain('Esa categoría ya no existe.')
      await asUser(db, admin)
      expect(await errOf(() => rpc('public.admin_list_category_note_shortcuts($1)', [id]))).toContain('Esa categoría ya no existe.')
    }
    expect(await snap()).toBe(before)
  })

  it('the scoped admin rpcs still reject the category scope as a list', async () => {
    await asUser(db, admin)
    expect(await errOf(() => rpc('public.admin_add_note_shortcut($1, $2)', ['category', 'X']))).toContain('Lista de atajos inválida.')
    expect(await errOf(() => rpc('public.admin_list_note_shortcuts($1)', ['category']))).toContain('Lista de atajos inválida.')
  })

  it('moves only within its own category, stays put at the ends', async () => {
    await add(burgers, 'B1')
    const d1 = await add(drinks, 'D1')
    const b2 = await add(burgers, 'B2')
    const d2 = await add(drinks, 'D2')
    const b3 = await add(burgers, 'B3')
    await addScoped('pizza', 'P1')
    await addScoped('order', 'O1')
    await asUser(db, admin)
    await rpc('public.admin_move_note_shortcut($1, $2)', [b3, -1])
    expect(await labels(burgers)).toEqual(['B1', 'B3', 'B2'])
    await asUser(db, admin)
    await rpc('public.admin_move_note_shortcut($1, $2)', [b2, 1])
    expect(await labels(burgers)).toEqual(['B1', 'B3', 'B2'])
    await asUser(db, admin)
    await rpc('public.admin_move_note_shortcut($1, $2)', [d2, -1])
    expect(await labels(drinks)).toEqual(['D2', 'D1'])
    await asUser(db, admin)
    await rpc('public.admin_move_note_shortcut($1, $2)', [d1, 1])
    expect(await labels(drinks)).toEqual(['D2', 'D1'])
    expect(await labels(burgers)).toEqual(['B1', 'B3', 'B2'])
    await asUser(db, admin)
    expect(await rpc('public.admin_list_note_shortcuts($1)', ['pizza'])).toHaveLength(1)
    expect(await rpc('public.admin_list_note_shortcuts($1)', ['order'])).toHaveLength(1)
  })

  it('moving a pizza or order shortcut never touches category rows', async () => {
    const p1 = await addScoped('pizza', 'P1')
    await add(burgers, 'B1')
    await addScoped('pizza', 'P2')
    const o1 = await addScoped('order', 'O1')
    await addScoped('order', 'O2')
    await asSuperuser(db)
    const categoryBefore = JSON.stringify((await db.query(`select * from public.pizza_note_shortcuts where scope='category'`)).rows)
    await asUser(db, admin)
    await rpc('public.admin_move_note_shortcut($1, $2)', [p1, 1])
    await rpc('public.admin_move_note_shortcut($1, $2)', [o1, 1])
    await asSuperuser(db)
    expect(JSON.stringify((await db.query(`select * from public.pizza_note_shortcuts where scope='category'`)).rows)).toBe(categoryBefore)
    await asUser(db, admin)
    expect((await rpc('public.admin_list_note_shortcuts($1)', ['pizza'])).map((r: Json) => r.label)).toEqual(['P2', 'P1'])
    expect((await rpc('public.admin_list_note_shortcuts($1)', ['order'])).map((r: Json) => r.label)).toEqual(['O2', 'O1'])
  })

  it('deleting a category row leaves other categories and lists untouched and frees the label there only', async () => {
    const b = await add(burgers, 'Igual')
    await add(drinks, 'Igual')
    await addScoped('pizza', 'Igual')
    await asUser(db, admin)
    await rpc('public.admin_delete_note_shortcut($1)', [b])
    expect(await labels(burgers)).toEqual([])
    expect(await labels(drinks)).toEqual(['Igual'])
    await add(burgers, 'Igual')
    expect(await labels(burgers)).toEqual(['Igual'])
  })

  it('deleting a category deletes its shortcuts and nothing else', async () => {
    await add(burgers, 'B1')
    await add(drinks, 'D1')
    await addScoped('pizza', 'P1')
    await asSuperuser(db)
    await db.query('delete from public.categories where id = $1', [burgers])
    const left = await db.query<{ scope: string; label: string }>(`select scope, label from public.pizza_note_shortcuts order by label`)
    expect(left.rows).toEqual([
      { scope: 'category', label: 'D1' },
      { scope: 'pizza', label: 'P1' },
    ])
  })

  it('is admin only: anon, cashier and waiter cannot call the category rpcs; the table stays unchanged', async () => {
    const id = await add(burgers, 'A')
    const before = await snap()
    const calls: Array<[string, unknown[]]> = [
      ['public.admin_list_category_note_shortcuts($1)', [burgers]],
      ['public.admin_add_category_note_shortcut($1, $2)', [burgers, 'B']],
      ['public.admin_delete_note_shortcut($1)', [id]],
      ['public.admin_move_note_shortcut($1, $2)', [id, 1]],
    ]
    for (const [sql, params] of calls) {
      await asAnon(db)
      expect(await errOf(() => rpc(sql, params))).toContain('permission denied')
      for (const user of [cashier, waiter, crypto.randomUUID()]) {
        await asUser(db, user)
        expect(await errOf(() => rpc(sql, params))).toContain('Solo un administrador puede editar las pizzas.')
      }
    }
    expect(await snap()).toBe(before)
  })

  it('has no direct table access for clients', async () => {
    await add(burgers, 'A')
    await asUser(db, admin)
    expect(await errOf(() => db.query('select * from public.pizza_note_shortcuts'))).toContain('permission denied')
    await asAnon(db)
    expect(await errOf(() => db.query('select category_id from public.pizza_note_shortcuts'))).toContain('permission denied')
  })

  it('the table refuses a category row without a category and a pizza row with one', async () => {
    await asSuperuser(db)
    await expect(db.query(`insert into public.pizza_note_shortcuts (scope, label, sort_order) values ('category', 'x', 1)`)).rejects.toThrow()
    await expect(
      db.query(`insert into public.pizza_note_shortcuts (scope, category_id, label, sort_order) values ('pizza', $1, 'x', 1)`, [burgers]),
    ).rejects.toThrow()
  })
})

describe('S4 reading category note shortcuts', () => {
  it('returns categories as { id: labels } in order, only categories with shortcuts, pizza/order unchanged', async () => {
    await addScoped('pizza', 'Sin cebolla')
    await addScoped('order', 'Cubiertos')
    await add(burgers, 'B')
    await add(burgers, 'A')
    const expected = { pizza: ['Sin cebolla'], order: ['Cubiertos'], categories: { [burgers]: ['B', 'A'] } }
    for (const user of [admin, cashier]) {
      await asUser(db, user)
      expect(await rpc('public.list_note_shortcuts()')).toEqual(expected)
    }
    const w = await registerDevice('waiter')
    await asAnon(db)
    expect(await rpc('public.device_list_note_shortcuts($1)', [w.device_secret])).toEqual(expected)
  })

  it('returns an empty categories object when none, and drops a category once its list is empty', async () => {
    await asUser(db, cashier)
    expect(await rpc('public.list_note_shortcuts()')).toEqual({ pizza: [], order: [], categories: {} })
    const id = await add(burgers, 'A')
    await asUser(db, admin)
    await rpc('public.admin_delete_note_shortcut($1)', [id])
    await asUser(db, cashier)
    expect((await rpc('public.list_note_shortcuts()')).categories).toEqual({})
  })

  it('keeps the read rules: waiter profile, anon, revoked and kitchen devices are rejected', async () => {
    await add(burgers, 'A')
    const k = await registerDevice('kitchen_pizza')
    const revoked = await registerDevice('waiter')
    await asUser(db, admin)
    await rpc('public.admin_revoke_device($1)', [revoked.device_id])
    await asUser(db, waiter)
    expect(await errOf(() => rpc('public.list_note_shortcuts()'))).toContain('No tienes permiso')
    await asAnon(db)
    expect(await errOf(() => rpc('public.list_note_shortcuts()'))).not.toBe('NO ERROR')
    expect(await errOf(() => rpc('public.device_list_note_shortcuts($1)', ['nope']))).toContain('no está autorizado')
    expect(await errOf(() => rpc('public.device_list_note_shortcuts($1)', [revoked.device_secret]))).toContain('no está autorizado')
    expect(await errOf(() => rpc('public.device_list_note_shortcuts($1)', [k.device_secret]))).toContain('no es de mesero')
    expect(await errOf(() => rpc('public.note_shortcut_labels()'))).toContain('permission denied')
  })

  it('grants: only the device read is open to anon; category rpcs are authenticated; helper is closed', async () => {
    const f = await db.query<any>(`select p.proname, p.prosecdef,
        has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like '%note_shortcut%' order by 1`)
    expect(Object.fromEntries(f.rows.map((x) => [x.proname, [x.anon, x.auth, x.prosecdef]]))).toEqual({
      admin_add_category_note_shortcut: [false, true, true],
      admin_add_note_shortcut: [false, true, true],
      admin_delete_note_shortcut: [false, true, true],
      admin_list_category_note_shortcuts: [false, true, true],
      admin_list_note_shortcuts: [false, true, true],
      admin_move_note_shortcut: [false, true, true],
      device_list_note_shortcuts: [true, true, true],
      list_note_shortcuts: [false, true, true],
      note_shortcut_labels: [false, false, true],
    })
  })
})
