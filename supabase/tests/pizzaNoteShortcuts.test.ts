// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

let db: TestDb
let admin: string
let cashier: string
let waiter: string

async function rpc(sql: string, params: unknown[] = []): Promise<any> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

async function add(label: string, scope: string = 'pizza'): Promise<string> {
  await asUser(db, admin)
  return (await rpc('public.admin_add_note_shortcut($1, $2)', [scope, label])).id
}

async function adminLabels(scope: string = 'pizza'): Promise<string[]> {
  await asUser(db, admin)
  return (await rpc('public.admin_list_note_shortcuts($1)', [scope])).map((row: Json) => row.label)
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
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('admin note shortcuts', () => {
  it('adds trimmed labels and lists them with id and label in order', async () => {
    const first = await add('  Sin cebolla  ')
    const second = await add('Bien cocida')
    await asUser(db, admin)
    expect(await rpc('public.admin_list_note_shortcuts($1)', ['pizza'])).toEqual([
      { id: first, label: 'Sin cebolla' },
      { id: second, label: 'Bien cocida' },
    ])
  })

  it('rejects a duplicate ignoring case and spaces, leaving the list unchanged', async () => {
    await add('Sin cebolla')
    await expect(add('  SIN CEBOLLA ')).rejects.toThrow('Ese atajo ya existe.')
    expect(await adminLabels()).toEqual(['Sin cebolla'])
  })

  it('rejects blank labels and null', async () => {
    await expect(add('')).rejects.toThrow('Escribe el texto del atajo.')
    await expect(add('   ')).rejects.toThrow('Escribe el texto del atajo.')
    await asUser(db, admin)
    await expect(rpc('public.admin_add_note_shortcut($1, $2)', ['pizza', null])).rejects.toThrow('Escribe el texto del atajo.')
    expect(await adminLabels()).toEqual([])
  })

  it('accepts 40 characters and rejects 41', async () => {
    await add('a'.repeat(40))
    await expect(add('b'.repeat(41))).rejects.toThrow('El atajo admite hasta 40 caracteres.')
    expect(await adminLabels()).toEqual(['a'.repeat(40)])
  })

  it('caps the list at 12', async () => {
    for (let i = 1; i <= 12; i++) await add(`Atajo ${i}`)
    await expect(add('Atajo 13')).rejects.toThrow('Puedes tener hasta 12 atajos de notas.')
    expect(await adminLabels()).toHaveLength(12)
  })

  it('moves up and down, stays put at the ends and rejects bad directions or unknown ids', async () => {
    const a = await add('A')
    const b = await add('B')
    const c = await add('C')
    await asUser(db, admin)
    await rpc('public.admin_move_note_shortcut($1, $2)', [c, -1])
    expect(await adminLabels()).toEqual(['A', 'C', 'B'])
    await rpc('public.admin_move_note_shortcut($1, $2)', [a, -1])
    await rpc('public.admin_move_note_shortcut($1, $2)', [b, 1])
    expect(await adminLabels()).toEqual(['A', 'C', 'B'])
    await rpc('public.admin_move_note_shortcut($1, $2)', [a, 1])
    expect(await adminLabels()).toEqual(['C', 'A', 'B'])
    await expect(rpc('public.admin_move_note_shortcut($1, $2)', [a, 2])).rejects.toThrow('Dirección inválida.')
    await expect(
      rpc('public.admin_move_note_shortcut($1, $2)', ['00000000-0000-0000-0000-000000000000', 1]),
    ).rejects.toThrow('Ese atajo ya no está en la lista.')
    expect(await adminLabels()).toEqual(['C', 'A', 'B'])
  })

  it('deletes a shortcut, lets the label be reused and appends new ones at the end', async () => {
    await add('A')
    const b = await add('B')
    await add('C')
    await asUser(db, admin)
    await rpc('public.admin_delete_note_shortcut($1)', [b])
    expect(await adminLabels()).toEqual(['A', 'C'])
    await add('B')
    expect(await adminLabels()).toEqual(['A', 'C', 'B'])
  })

  it('is admin only: anon, cashier and waiter cannot call any admin rpc', async () => {
    const id = await add('A')
    const calls: Array<[string, unknown[]]> = [
      ['public.admin_list_note_shortcuts($1)', ['pizza']],
      ['public.admin_add_note_shortcut($1, $2)', ['pizza', 'B']],
      ['public.admin_delete_note_shortcut($1)', [id]],
      ['public.admin_move_note_shortcut($1, $2)', [id, 1]],
    ]
    for (const [sql, params] of calls) {
      await asAnon(db)
      await expect(rpc(sql, params)).rejects.toThrow()
      for (const user of [cashier, waiter]) {
        await asUser(db, user)
        await expect(rpc(sql, params)).rejects.toThrow('Solo un administrador puede editar las pizzas.')
      }
    }
    expect(await adminLabels()).toEqual(['A'])
  })

  it('has no direct table access for clients', async () => {
    await add('A')
    await asUser(db, admin)
    await expect(db.query('select * from public.pizza_note_shortcuts')).rejects.toThrow('permission denied')
    await expect(db.query(`insert into public.pizza_note_shortcuts (scope, label, sort_order) values ('pizza', 'x', 1)`)).rejects.toThrow('permission denied')
    await asAnon(db)
    await expect(db.query('select * from public.pizza_note_shortcuts')).rejects.toThrow('permission denied')
  })
})

describe('reading note shortcuts', () => {
  it('list_note_shortcuts returns both lists of labels in order to admin and cashier, not to waiter or anon', async () => {
    await add('B')
    await add('A')
    for (const user of [admin, cashier]) {
      await asUser(db, user)
      expect(await rpc('public.list_note_shortcuts()')).toEqual({ pizza: ['B', 'A'], order: [], categories: {} })
    }
    await asUser(db, waiter)
    await expect(rpc('public.list_note_shortcuts()')).rejects.toThrow('No tienes permiso')
    await asAnon(db)
    await expect(rpc('public.list_note_shortcuts()')).rejects.toThrow()
  })

  it('returns an empty list when there are none', async () => {
    await asUser(db, cashier)
    expect(await rpc('public.list_note_shortcuts()')).toEqual({ pizza: [], order: [], categories: {} })
  })

  it('device_list_note_shortcuts serves waiter devices only', async () => {
    await add('B')
    await add('A')
    const w = await registerDevice('waiter')
    const k = await registerDevice('kitchen_pizza')
    const revoked = await registerDevice('waiter')
    await asUser(db, admin)
    await rpc('public.admin_revoke_device($1)', [revoked.device_id])

    await asAnon(db)
    expect(await rpc('public.device_list_note_shortcuts($1)', [w.device_secret])).toEqual({ pizza: ['B', 'A'], order: [], categories: {} })
    await expect(rpc('public.device_list_note_shortcuts($1)', ['nope'])).rejects.toThrow('no está autorizado')
    await expect(rpc('public.device_list_note_shortcuts($1)', [null])).rejects.toThrow('no está autorizado')
    await expect(rpc('public.device_list_note_shortcuts($1)', [revoked.device_secret])).rejects.toThrow('no está autorizado')
    await expect(rpc('public.device_list_note_shortcuts($1)', [k.device_secret])).rejects.toThrow('no es de mesero')
  })
})

describe('note shortcut scopes', () => {
  it('keeps the pizza and order lists apart, each in its own order', async () => {
    await add('Sin cebolla')
    await add('Cubiertos', 'order')
    await add('Bien cocida')
    await add('Pagan con $500', 'order')
    expect(await adminLabels('pizza')).toEqual(['Sin cebolla', 'Bien cocida'])
    expect(await adminLabels('order')).toEqual(['Cubiertos', 'Pagan con $500'])
  })

  it('allows the same label once per scope, ignoring case, and rejects it twice in one scope', async () => {
    await add('Sin hielo')
    await add('SIN HIELO', 'order')
    await expect(add(' sin hielo ', 'order')).rejects.toThrow('Ese atajo ya existe.')
    expect(await adminLabels('pizza')).toEqual(['Sin hielo'])
    expect(await adminLabels('order')).toEqual(['SIN HIELO'])
  })

  it('caps each scope at 12 on its own, with its own message', async () => {
    for (let i = 1; i <= 12; i++) await add(`Atajo ${i}`)
    await add('Cubiertos', 'order')
    await expect(add('Atajo 13')).rejects.toThrow('Puedes tener hasta 12 atajos de notas.')
    for (let i = 2; i <= 12; i++) await add(`Pedido ${i}`, 'order')
    await expect(add('Pedido 13', 'order')).rejects.toThrow('Puedes tener hasta 12 atajos de nota del pedido.')
    expect(await adminLabels('pizza')).toHaveLength(12)
    expect(await adminLabels('order')).toHaveLength(12)
  })

  it('moves only within its own list', async () => {
    await add('P1')
    const o1 = await add('O1', 'order')
    await add('P2')
    const o2 = await add('O2', 'order')
    await asUser(db, admin)
    await rpc('public.admin_move_note_shortcut($1, $2)', [o2, -1])
    expect(await adminLabels('order')).toEqual(['O2', 'O1'])
    await rpc('public.admin_move_note_shortcut($1, $2)', [o2, -1])
    expect(await adminLabels('order')).toEqual(['O2', 'O1'])
    await rpc('public.admin_move_note_shortcut($1, $2)', [o1, 1])
    expect(await adminLabels('order')).toEqual(['O2', 'O1'])
    expect(await adminLabels('pizza')).toEqual(['P1', 'P2'])
  })

  it('deleting in one scope leaves the other untouched and frees the label there only', async () => {
    const p = await add('Igual')
    await add('Igual', 'order')
    await asUser(db, admin)
    await rpc('public.admin_delete_note_shortcut($1)', [p])
    expect(await adminLabels('pizza')).toEqual([])
    expect(await adminLabels('order')).toEqual(['Igual'])
  })

  it('rejects an unknown or missing scope without changing anything', async () => {
    await asUser(db, admin)
    for (const scope of ['kitchen', '', null]) {
      await expect(rpc('public.admin_add_note_shortcut($1, $2)', [scope, 'X'])).rejects.toThrow('Lista de atajos inválida.')
      await expect(rpc('public.admin_list_note_shortcuts($1)', [scope])).rejects.toThrow('Lista de atajos inválida.')
    }
    expect(await adminLabels('pizza')).toEqual([])
    expect(await adminLabels('order')).toEqual([])
  })

  it('the admin rpcs with a scope stay admin only', async () => {
    await add('A', 'order')
    for (const user of [cashier, waiter]) {
      await asUser(db, user)
      await expect(rpc('public.admin_list_note_shortcuts($1)', ['order'])).rejects.toThrow('Solo un administrador puede editar las pizzas.')
      await expect(rpc('public.admin_add_note_shortcut($1, $2)', ['order', 'B'])).rejects.toThrow('Solo un administrador puede editar las pizzas.')
    }
    await asAnon(db)
    await expect(rpc('public.admin_add_note_shortcut($1, $2)', ['order', 'B'])).rejects.toThrow()
    expect(await adminLabels('order')).toEqual(['A'])
  })

  it('both read rpcs return pizza and order labels, labels only', async () => {
    await add('Sin cebolla')
    await add('Cubiertos', 'order')
    await add('Entregar rápido', 'order')
    const expected = { pizza: ['Sin cebolla'], order: ['Cubiertos', 'Entregar rápido'], categories: {} }
    await asUser(db, cashier)
    expect(await rpc('public.list_note_shortcuts()')).toEqual(expected)
    const w = await registerDevice('waiter')
    await asAnon(db)
    expect(await rpc('public.device_list_note_shortcuts($1)', [w.device_secret])).toEqual(expected)
  })
})
