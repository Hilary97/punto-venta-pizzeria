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
let styleIds: Record<string, string>
let admin: string
let cashier: string
let waiter: string

/** A pizza line of the given size; one style per portion (a size's allowed portions decide how many). */
function pizza(size: string, quantity = 1, styles: string[] = ['Estilo Varas'], extra: Json = {}) {
  return {
    type: 'pizza',
    quantity,
    pizza: {
      size,
      portions: styles.map((s) => ({ style_id: styleIds[s], ingredient_ids: [], extra_ingredient_ids: [], extra_cheese: false })),
    },
    ...extra,
  }
}

const soda = (quantity: number) => ({ product_id: fx.sodaId, quantity })

async function setDough(size: string, prepared: number) {
  await asUser(db, admin)
  return rpc(db, 'public.admin_set_pizza_dough($1, $2)', [size, prepared])
}

/** The size's row of the current dough shift. */
async function dayRow(size: string): Promise<{ prepared: number; used: number } | undefined> {
  await asSuperuser(db)
  const res = await db.query<{ prepared: number; used: number }>(
    `select prepared, used from public.pizza_dough_days
     where shift_id = (select max(id) from public.pizza_dough_shifts) and size_code = $1`,
    [size],
  )
  return res.rows[0]
}

async function openRegister() {
  await asUser(db, cashier)
  return (await rpc(db, 'public.open_cash_session($1)', [0])).session_id as string
}

async function closeRegister() {
  await asUser(db, cashier)
  await rpc(db, 'public.close_cash_session($1)', [0])
}

async function countRows(table: string): Promise<number> {
  await asSuperuser(db)
  const res = await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)
  return res.rows[0].n
}

async function createOrder(items: Json[], tableNumber = 3) {
  await asUser(db, cashier)
  const res = await rpc(db, 'public.create_order($1, $2, $3::jsonb)', [tableNumber, null, JSON.stringify(items)])
  return res.order_id as string
}

async function addItems(orderId: string, items: Json[]) {
  await asUser(db, cashier)
  await rpc(db, 'public.add_order_items($1, $2::jsonb)', [orderId, JSON.stringify(items)])
}

async function cancel(orderId: string) {
  await asUser(db, cashier)
  await rpc(db, 'public.cancel_order($1)', [orderId])
}

/** The dough shift each line of the order took (null when the line took no dough). */
async function doughDays(orderId: string): Promise<(number | null)[]> {
  await asSuperuser(db)
  const res = await db.query<{ d: number | null }>(
    `select dough_shift::int as d from public.order_items where order_id = $1 order by id`,
    [orderId],
  )
  return res.rows.map((r) => r.d)
}

/** The current dough shift. */
async function today(): Promise<number> {
  await asSuperuser(db)
  return (await db.query<{ d: number }>(`select max(id)::int as d from public.pizza_dough_shifts`)).rows[0].d
}

async function sodaStock(): Promise<number> {
  await asSuperuser(db)
  return (await db.query<{ stock: number }>(`select stock from public.products where id = $1`, [fx.sodaId])).rows[0].stock
}

beforeEach(async () => {
  db = await createTestDb()
  fx = await loadFixture(db)
  await asSuperuser(db)
  const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
  styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
  admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  waiter = await createProfile(db, { role: 'waiter', fullName: 'Mesero' })
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('business day', () => {
  const at = async (ts: string) => {
    await asSuperuser(db)
    return (await db.query<{ d: string }>(`select public.pizza_business_day_at($1::timestamptz)::text as d`, [ts])).rows[0].d
  }

  it('changes at 05:00 Mexico City', async () => {
    expect(await at('2026-10-21T04:59:00-06:00')).toBe('2026-10-20')
    expect(await at('2026-10-21T05:00:00-06:00')).toBe('2026-10-21')
    expect(await at('2026-10-21T00:30:00-06:00')).toBe('2026-10-20')
    expect(await at('2026-10-21T23:59:00-06:00')).toBe('2026-10-21')
  })

  it('stays on the Mexico City clock whatever the offset of the input', async () => {
    expect(await at('2026-10-21T10:59:00Z')).toBe('2026-10-20')
    expect(await at('2026-10-21T11:00:00Z')).toBe('2026-10-21')
  })

  it('the stable helper is the one at now()', async () => {
    await asSuperuser(db)
    const res = await db.query<{ same: boolean }>(`select public.pizza_business_day() = public.pizza_business_day_at(now()) as same`)
    expect(res.rows[0].same).toBe(true)
  })
})

describe('dough on orders', () => {
  it('is unlimited without a row: no deduction and no dough_day', async () => {
    const id = await createOrder([pizza('grande', 3)])
    expect(await doughDays(id)).toEqual([null])
    expect(await dayRow('grande')).toBeUndefined()
  })

  it('deducts the quantity of a line from its size only', async () => {
    await setDough('chica', 10)
    await setDough('mediana', 10)
    const id = await createOrder([pizza('chica', 3)])
    expect(await dayRow('chica')).toEqual({ prepared: 10, used: 3 })
    expect(await dayRow('mediana')).toEqual({ prepared: 10, used: 0 })
    expect(await doughDays(id)).toEqual([await today()])
  })

  it('counts one dough per pizza whatever the portions, styles and extra lines', async () => {
    await setDough('mediana', 20)
    await setDough('grande', 20)
    await createOrder([
      pizza('mediana', 2, ['Estilo Varas', "Estilo Chuy's"]),
      pizza('mediana', 1, ['Estilo Varas'], { notes: 'cortada en 8' }),
      pizza('grande', 1, ['Estilo Varas', "Estilo Chuy's", 'Estilo Varas', "Estilo Chuy's"]),
      soda(2),
    ])
    expect(await dayRow('mediana')).toEqual({ prepared: 20, used: 3 })
    expect(await dayRow('grande')).toEqual({ prepared: 20, used: 1 })
  })

  it('blocks when the total of the payload exceeds what is left and changes nothing', async () => {
    await setDough('chica', 3)
    await createOrder([pizza('chica', 1)])
    const orders = await countRows('orders')
    const items = await countRows('order_items')
    await expect(createOrder([pizza('chica', 1), pizza('chica', 2, ['Estilo Varas'], { notes: 'x' })], 4)).rejects.toThrow(
      'No hay masas de pizza Chica: quedan 2.',
    )
    expect(await dayRow('chica')).toEqual({ prepared: 3, used: 1 })
    expect(await countRows('orders')).toBe(orders)
    expect(await countRows('order_items')).toBe(items)
  })

  it('names the size and reports zero when it ran out', async () => {
    await setDough('grande', 1)
    await createOrder([pizza('grande', 1)])
    await expect(createOrder([pizza('grande', 1)], 4)).rejects.toThrow('No hay masas de pizza Grande: quedan 0.')
  })

  it('lets a line through when it exactly uses what is left', async () => {
    await setDough('mediana', 2)
    await createOrder([pizza('mediana', 2)])
    expect(await dayRow('mediana')).toEqual({ prepared: 2, used: 2 })
  })

  it('does not block sizes without a row nor other products when another size ran out', async () => {
    await setDough('chica', 1)
    await createOrder([pizza('grande', 4), soda(1)])
    await expect(createOrder([pizza('chica', 2)], 4)).rejects.toThrow('No hay masas de pizza Chica: quedan 1.')
  })

  it('blocks add_order_items beyond the dough and rolls the order back to what it had', async () => {
    await setDough('chica', 3)
    const id = await createOrder([pizza('chica', 2)])
    const items = await countRows('order_items')
    await expect(addItems(id, [pizza('chica', 2)])).rejects.toThrow('No hay masas de pizza Chica: quedan 1.')
    expect(await dayRow('chica')).toEqual({ prepared: 3, used: 2 })
    expect(await countRows('order_items')).toBe(items)
    await addItems(id, [pizza('chica', 1)])
    expect(await dayRow('chica')).toEqual({ prepared: 3, used: 3 })
  })

  it('rolls back product stock and dough together when either fails', async () => {
    await asSuperuser(db)
    await db.query(`update public.products set track_stock = true, stock = 2 where id = $1`, [fx.sodaId])
    await setDough('chica', 5)
    const orders = await countRows('orders')
    await expect(createOrder([pizza('chica', 2), soda(3)])).rejects.toThrow('No hay suficiente Refresco: quedan 2.')
    expect(await dayRow('chica')).toEqual({ prepared: 5, used: 0 })
    expect(await sodaStock()).toBe(2)

    await setDough('chica', 1)
    await expect(createOrder([soda(2), pizza('chica', 2)])).rejects.toThrow('No hay masas de pizza Chica: quedan 1.')
    expect(await dayRow('chica')).toEqual({ prepared: 1, used: 0 })
    expect(await sodaStock()).toBe(2)
    expect(await countRows('orders')).toBe(orders)
  })

  it('ignores malformed items in the dough check; the line loop still rejects them', async () => {
    await setDough('chica', 1)
    await expect(createOrder([pizza('chica', 1), { type: 'pizza', quantity: 'x', pizza: { size: 'chica' } }])).rejects.toThrow(
      'Uno de los artículos del pedido es inválido.',
    )
    expect(await dayRow('chica')).toEqual({ prepared: 1, used: 0 })
  })

  it('counts a zero-padded quantity in the pre-check and deducts it once', async () => {
    await setDough('chica', 1)
    await expect(createOrder([pizza('chica', '0000000001' as unknown as number), pizza('chica', 1)])).rejects.toThrow(
      'No hay masas de pizza Chica: quedan 1.',
    )
    expect(await dayRow('chica')).toEqual({ prepared: 1, used: 0 })

    const orderId = await createOrder([pizza('chica', '0000000001' as unknown as number)])
    expect(await dayRow('chica')).toEqual({ prepared: 1, used: 1 })
    expect(await doughDays(orderId)).toEqual([await today()])
  })

  it.each([2000000000, '1000000000', '0001000000000'])(
    'rejects the quantity %s as invalid before taking any dough, so no path skips the pre-check',
    async (quantity) => {
      await setDough('chica', 5)
      const orders = await countRows('orders')
      await expect(createOrder([pizza('chica', quantity as number)])).rejects.toThrow('Uno de los artículos del pedido es inválido.')
      expect(await dayRow('chica')).toEqual({ prepared: 5, used: 0 })
      expect(await countRows('orders')).toBe(orders)
    },
  )

  it('treats a size whose row appeared after the pre-check as unlimited: no lock, no deduction, no dough_day', async () => {
    // The trigger plays the admin loading the size while the order is being written.
    await asSuperuser(db)
    await db.query(`
      create function public.test_late_dough() returns trigger language plpgsql as $$
      begin
        insert into public.pizza_dough_days (shift_id, size_code, prepared)
        values ((select max(id) from public.pizza_dough_shifts), 'chica', 0) on conflict do nothing;
        return new;
      end $$`)
    await db.query(`
      create trigger test_late_dough after insert on public.order_items
      for each row execute function public.test_late_dough()`)
    const orderId = await createOrder([soda(1), pizza('chica', 1)])
    expect(await doughDays(orderId)).toEqual([null, null])
    expect(await dayRow('chica')).toEqual({ prepared: 0, used: 0 })
  })

  it('never deducts a product whose tracking was switched on after the pre-check locked it as untracked', async () => {
    // The trigger plays the admin switching tracking on while the order is being written.
    await asSuperuser(db)
    await db.query(`
      create function public.test_late_tracking() returns trigger language plpgsql as $$
      begin
        update public.products set track_stock = true, stock = 10 where id = '${fx.sodaId}';
        return new;
      end $$`)
    await db.query(`
      create trigger test_late_tracking after insert on public.order_items
      for each row when (new.product_id = '${fx.pizzaId}') execute function public.test_late_tracking()`)
    const orderId = await createOrder([{ product_id: fx.pizzaId, quantity: 1 }, soda(1)])
    await asSuperuser(db)
    const soldSoda = await db.query<{ stocked_quantity: number }>(
      `select stocked_quantity from public.order_items where order_id = $1 and product_id = $2`,
      [orderId, fx.sodaId],
    )
    expect(soldSoda.rows).toEqual([{ stocked_quantity: 0 }])
    const stock = await db.query<{ stock: number }>(`select stock from public.products where id = $1`, [fx.sodaId])
    expect(stock.rows[0].stock).toBe(10)
  })

  it('locks every product of the payload before any dough row (structure of insert_order_lines)', async () => {
    await asSuperuser(db)
    const def = (await db.query<{ d: string }>(`select pg_get_functiondef('public.insert_order_lines(uuid, jsonb)'::regprocedure) as d`)).rows[0].d
    const trackedLock = def.indexOf('for no key update of p')
    const untrackedLock = def.indexOf('for share of p')
    const doughLock = def.indexOf('for no key update of d')
    expect(trackedLock).toBeGreaterThan(-1)
    expect(untrackedLock).toBeGreaterThan(-1)
    expect(doughLock).toBeGreaterThan(-1)
    // The up-front loops come first: tracked and untracked product locks, then the dough rows.
    expect(Math.max(trackedLock, untrackedLock)).toBeLessThan(doughLock)
    // The per-line dough read never locks: only rows the pre-check locked are touched.
    expect(def.match(/for no key update/g)).toHaveLength(2)
  })

  it('keeps ordering an untracked product alongside tracked ones and pizzas', async () => {
    await asSuperuser(db)
    await db.query(`update public.products set track_stock = false where id = $1`, [fx.sodaId])
    await setDough('chica', 2)
    const orderId = await createOrder([soda(3), pizza('chica', 2)])
    expect((await doughDays(orderId)).sort()).toEqual([await today(), null].sort())
    expect(await dayRow('chica')).toEqual({ prepared: 2, used: 2 })
  })

  it('works through device_create_order and device_add_order_items', async () => {
    await setDough('mediana', 2)
    await asUser(db, admin)
    const waiterId = (await rpc(db, 'public.admin_create_waiter($1, $2)', ['Luis', '1234'])).waiter_id
    const secret = (await rpc(db, 'public.admin_register_device($1)', ['Tablet 1'])).device_secret
    await asAnon(db)
    const token = (await rpc(db, 'public.device_start_shift($1, $2, $3)', [secret, waiterId, '1234'])).token
    const created = await rpc(db, 'public.device_create_order($1, $2, $3, $4, $5::jsonb)', [
      secret,
      token,
      2,
      null,
      JSON.stringify([pizza('mediana', 1)]),
    ])
    expect(await dayRow('mediana')).toEqual({ prepared: 2, used: 1 })
    await asAnon(db)
    await expect(
      rpc(db, 'public.device_add_order_items($1, $2, $3, $4::jsonb)', [secret, token, created.order_id, JSON.stringify([pizza('mediana', 2)])]),
    ).rejects.toThrow('No hay masas de pizza Mediana: quedan 1.')
    await asAnon(db)
    await rpc(db, 'public.device_add_order_items($1, $2, $3, $4::jsonb)', [secret, token, created.order_id, JSON.stringify([pizza('mediana', 1)])])
    expect(await dayRow('mediana')).toEqual({ prepared: 2, used: 2 })
    await asAnon(db)
    await expect(
      rpc(db, 'public.device_create_order($1, $2, $3, $4, $5::jsonb)', [secret, token, 3, null, JSON.stringify([pizza('mediana', 1)])]),
    ).rejects.toThrow('No hay masas de pizza Mediana: quedan 0.')
  })
})

describe('dough on cancel', () => {
  it('gives back what the order took', async () => {
    await setDough('chica', 5)
    await setDough('grande', 5)
    const id = await createOrder([pizza('chica', 2), pizza('grande', 1)])
    await addItems(id, [pizza('chica', 1)])
    expect(await dayRow('chica')).toEqual({ prepared: 5, used: 3 })
    await cancel(id)
    expect(await dayRow('chica')).toEqual({ prepared: 5, used: 0 })
    expect(await dayRow('grande')).toEqual({ prepared: 5, used: 0 })
  })

  it('also restores after the admin raised the prepared count, and the dough can be sold again', async () => {
    await setDough('chica', 2)
    const id = await createOrder([pizza('chica', 2)])
    await setDough('chica', 6)
    await cancel(id)
    expect(await dayRow('chica')).toEqual({ prepared: 6, used: 0 })
    await createOrder([pizza('chica', 6)], 4)
  })

  it('does not touch dough for lines that took none', async () => {
    const id = await createOrder([pizza('chica', 2)])
    await setDough('chica', 5)
    await cancel(id)
    expect(await dayRow('chica')).toEqual({ prepared: 5, used: 0 })
  })

  it('restores to the shift the line took, even after the register was closed', async () => {
    await openRegister()
    await setDough('chica', 5)
    const id = await createOrder([pizza('chica', 2)])
    const tookShift = await today()
    await closeRegister()
    await setDough('chica', 4)
    await createOrder([pizza('chica', 1)], 4)
    await cancel(id)
    await asSuperuser(db)
    const rows = await db.query<{ s: number; prepared: number; used: number }>(
      `select shift_id::int as s, prepared, used from public.pizza_dough_days order by shift_id`,
    )
    expect(rows.rows).toEqual([
      { s: tookShift, prepared: 5, used: 0 },
      { s: await today(), prepared: 4, used: 1 },
    ])
  })
})

describe('admin_set_pizza_dough', () => {
  it("creates today's row and returns the numbers", async () => {
    const res = await setDough('mediana', 12)
    expect(res).toMatchObject({ shift_id: await today(), size_code: 'mediana', prepared: 12, used: 0, left: 12 })
    expect(await dayRow('mediana')).toEqual({ prepared: 12, used: 0 })
  })

  it('raises or lowers the load down to what is used', async () => {
    await setDough('chica', 5)
    await createOrder([pizza('chica', 3)])
    expect(await setDough('chica', 9)).toMatchObject({ prepared: 9, used: 3, left: 6 })
    expect(await setDough('chica', 3)).toMatchObject({ prepared: 3, used: 3, left: 0 })
    expect(await dayRow('chica')).toEqual({ prepared: 3, used: 3 })
  })

  it('rejects less than what is already used', async () => {
    await setDough('chica', 5)
    await createOrder([pizza('chica', 3)])
    await expect(setDough('chica', 2)).rejects.toThrow('No puedes cargar menos masas de las que ya se usaron (3).')
    expect(await dayRow('chica')).toEqual({ prepared: 5, used: 3 })
  })

  it('accepts zero as an empty load', async () => {
    await setDough('chica', 0)
    await expect(createOrder([pizza('chica', 1)])).rejects.toThrow('No hay masas de pizza Chica: quedan 0.')
  })

  it('rejects negative and null amounts', async () => {
    await asUser(db, admin)
    await expect(rpc(db, 'public.admin_set_pizza_dough($1, $2)', ['chica', -1])).rejects.toThrow('La cantidad de masas no es válida.')
    await expect(rpc(db, 'public.admin_set_pizza_dough($1, $2)', ['chica', null])).rejects.toThrow('La cantidad de masas no es válida.')
    expect(await dayRow('chica')).toBeUndefined()
  })

  it('rejects more than 100000 doughs and changes nothing', async () => {
    await setDough('chica', 3)
    await asUser(db, admin)
    await expect(rpc(db, 'public.admin_set_pizza_dough($1, $2)', ['chica', 100001])).rejects.toThrow('La cantidad de masas no es válida.')
    await expect(rpc(db, 'public.admin_set_pizza_dough($1, $2)', ['grande', 2147483647])).rejects.toThrow('La cantidad de masas no es válida.')
    expect(await dayRow('chica')).toEqual({ prepared: 3, used: 0 })
    expect(await dayRow('grande')).toBeUndefined()
    await setDough('chica', 100000)
    expect(await dayRow('chica')).toEqual({ prepared: 100000, used: 0 })
  })

  it('rejects unknown sizes', async () => {
    await asUser(db, admin)
    await expect(rpc(db, 'public.admin_set_pizza_dough($1, $2)', ['gigante', 5])).rejects.toThrow('El tamaño de pizza no existe.')
    await expect(rpc(db, 'public.admin_set_pizza_dough($1, $2)', [null, 5])).rejects.toThrow('El tamaño de pizza no existe.')
  })

  it('is admin only', async () => {
    for (const uid of [cashier, waiter]) {
      await asUser(db, uid)
      await expect(rpc(db, 'public.admin_set_pizza_dough($1, $2)', ['chica', 5])).rejects.toThrow(
        'Solo un administrador puede cargar las masas.',
      )
    }
    await asAnon(db)
    await expect(rpc(db, 'public.admin_set_pizza_dough($1, $2)', ['chica', 5])).rejects.toThrow()
    expect(await dayRow('chica')).toBeUndefined()
  })
})

describe('admin_list_pizza_dough', () => {
  it('lists prepared, used and left per size, with nulls for sizes without a row', async () => {
    await setDough('mediana', 8)
    await createOrder([pizza('mediana', 3)])
    await asUser(db, admin)
    const res = await rpc(db, 'public.admin_list_pizza_dough()')
    expect(res).not.toHaveProperty('business_day')
    await asSuperuser(db)
    const started = (await db.query<{ t: string }>(`select to_jsonb(started_at) #>> '{}' as t from public.pizza_dough_shifts order by id desc limit 1`)).rows[0].t
    expect(res.shift_started_at).toBe(started)
    expect(res.sizes).toEqual([
      { size_code: 'grande', name: 'Grande', prepared: null, used: null, left: null },
      { size_code: 'mediana', name: 'Mediana', prepared: 8, used: 3, left: 5 },
      { size_code: 'chica', name: 'Chica', prepared: null, used: null, left: null },
    ])
  })

  it('ignores rows of past shifts', async () => {
    await openRegister()
    await setDough('chica', 5)
    await closeRegister()
    await asUser(db, admin)
    const res = await rpc(db, 'public.admin_list_pizza_dough()')
    expect(res.sizes.find((s: Json) => s.size_code === 'chica')).toMatchObject({ prepared: null, left: null })
  })

  it('is admin only', async () => {
    await asUser(db, cashier)
    await expect(rpc(db, 'public.admin_list_pizza_dough()')).rejects.toThrow()
    await asUser(db, waiter)
    await expect(rpc(db, 'public.admin_list_pizza_dough()')).rejects.toThrow()
    await asAnon(db)
    await expect(rpc(db, 'public.admin_list_pizza_dough()')).rejects.toThrow()
  })
})

describe('list_pizza_dough_left', () => {
  it('gives every authenticated role the dough left, null when unlimited', async () => {
    await setDough('chica', 4)
    await createOrder([pizza('chica', 1)])
    const expected = [
      { size_code: 'grande', dough_left: null },
      { size_code: 'mediana', dough_left: null },
      { size_code: 'chica', dough_left: 3 },
    ]
    for (const uid of [admin, cashier, waiter]) {
      await asUser(db, uid)
      expect(await rpc(db, 'public.list_pizza_dough_left()')).toEqual(expected)
    }
  })

  it('is not callable by anon', async () => {
    await asAnon(db)
    await expect(rpc(db, 'public.list_pizza_dough_left()')).rejects.toThrow()
  })
})

describe('device_list_catalog', () => {
  it('includes dough_left in each size', async () => {
    await setDough('mediana', 5)
    await createOrder([pizza('mediana', 2)])
    await asUser(db, admin)
    const secret = (await rpc(db, 'public.admin_register_device($1)', ['Tablet 1'])).device_secret
    await asAnon(db)
    const catalog = await rpc(db, 'public.device_list_catalog($1)', [secret])
    expect(catalog.pizza.sizes.map((s: Json) => [s.code, s.dough_left])).toEqual([
      ['grande', null],
      ['mediana', 3],
      ['chica', null],
    ])
    expect(catalog.pizza.sizes[2]).toMatchObject({ name: 'Chica', allowed_portions: [1] })
  })
})

describe('table privileges', () => {
  it('lets only the admin read the table, and nobody write it directly', async () => {
    await setDough('chica', 5)

    await asUser(db, admin)
    expect((await db.query(`select * from public.pizza_dough_days`)).rows).toHaveLength(1)
    await expect(db.query(`update public.pizza_dough_days set prepared = 99`)).rejects.toThrow()
    await expect(
      db.query(`insert into public.pizza_dough_days (shift_id, size_code, prepared) values (1, 'grande', 5)`),
    ).rejects.toThrow()
    await expect(db.query(`delete from public.pizza_dough_days`)).rejects.toThrow()

    for (const uid of [cashier, waiter]) {
      await asUser(db, uid)
      expect((await db.query(`select * from public.pizza_dough_days`)).rows).toHaveLength(0)
      await expect(db.query(`update public.pizza_dough_days set prepared = 99`)).rejects.toThrow()
      await expect(
        db.query(`insert into public.pizza_dough_days (shift_id, size_code, prepared) values (1, 'grande', 5)`),
      ).rejects.toThrow()
    }

    await asAnon(db)
    await expect(db.query(`select * from public.pizza_dough_days`)).rejects.toThrow()
    await expect(db.query(`update public.pizza_dough_days set prepared = 99`)).rejects.toThrow()

    expect(await dayRow('chica')).toEqual({ prepared: 5, used: 0 })
  })

  it('keeps used within prepared even for a superuser', async () => {
    await asSuperuser(db)
    await expect(
      db.query(`insert into public.pizza_dough_days (shift_id, size_code, prepared, used) values (1, 'chica', 1, 2)`),
    ).rejects.toThrow()
    await expect(
      db.query(`insert into public.pizza_dough_days (shift_id, size_code, prepared, used) values (1, 'chica', -1, 0)`),
    ).rejects.toThrow()
  })

  it('lets only the admin read the shifts, and nobody write them directly', async () => {
    await asUser(db, admin)
    expect((await db.query(`select * from public.pizza_dough_shifts`)).rows).toHaveLength(1)
    await expect(db.query(`insert into public.pizza_dough_shifts default values`)).rejects.toThrow()
    await expect(db.query(`delete from public.pizza_dough_shifts`)).rejects.toThrow()
    for (const uid of [cashier, waiter]) {
      await asUser(db, uid)
      expect((await db.query(`select * from public.pizza_dough_shifts`)).rows).toHaveLength(0)
      await expect(db.query(`insert into public.pizza_dough_shifts default values`)).rejects.toThrow()
    }
    await asAnon(db)
    await expect(db.query(`select * from public.pizza_dough_shifts`)).rejects.toThrow()
    expect(await countRows('pizza_dough_shifts')).toBe(1)
  })
})

describe('dough shift ends when the register is closed', () => {
  const allLeft = async () => {
    await asUser(db, cashier)
    return (await rpc(db, 'public.list_pizza_dough_left()')) as unknown as Json[]
  }

  it('makes every size unlimited after closing the register', async () => {
    await openRegister()
    await setDough('chica', 1)
    await setDough('grande', 3)
    await createOrder([pizza('chica', 1)])
    await expect(createOrder([pizza('chica', 1)], 4)).rejects.toThrow('No hay masas de pizza Chica: quedan 0.')
    await closeRegister()

    expect(await allLeft()).toEqual([
      { size_code: 'grande', dough_left: null },
      { size_code: 'mediana', dough_left: null },
      { size_code: 'chica', dough_left: null },
    ])
    const id = await createOrder([pizza('chica', 5)], 4)
    expect(await doughDays(id)).toEqual([null])
    expect(await dayRow('chica')).toBeUndefined()
  })

  it('keeps doughs loaded before opening the register for the shift that follows', async () => {
    await openRegister()
    await closeRegister()
    await setDough('mediana', 2)
    await openRegister()
    await createOrder([pizza('mediana', 2)])
    await expect(createOrder([pizza('mediana', 1)], 4)).rejects.toThrow('No hay masas de pizza Mediana: quedan 0.')
    expect(await dayRow('mediana')).toEqual({ prepared: 2, used: 2 })
  })

  it('starts exactly one shift per close; opening and other updates of a session start none', async () => {
    const first = await today()
    const session = await openRegister()
    expect(await today()).toBe(first)
    await closeRegister()
    expect(await today()).toBe(first + 1)
    await asSuperuser(db)
    await db.query(`update public.cash_sessions set counted_cents = counted_cents + 1 where id = $1`, [session])
    expect(await today()).toBe(first + 1)
    expect(await countRows('pizza_dough_shifts')).toBe(2)
  })

  it('does not change the current shift when a closed session is deleted', async () => {
    const session = await openRegister()
    await closeRegister()
    await setDough('chica', 3)
    const current = await today()
    await asUser(db, admin)
    await rpc(db, 'public.delete_closed_cash_session($1)', [session])
    expect(await today()).toBe(current)
    expect(await dayRow('chica')).toEqual({ prepared: 3, used: 0 })
  })

  it('no restated dough function reads the clock-based business day anymore', async () => {
    await asSuperuser(db)
    for (const fn of [
      'public.insert_order_lines(uuid, jsonb)',
      'public.cancel_order_core(uuid)',
      'public.device_list_catalog(text)',
      'public.admin_set_pizza_dough(text, integer)',
      'public.admin_list_pizza_dough()',
      'public.list_pizza_dough_left()',
    ]) {
      const def = (await db.query<{ d: string }>(`select pg_get_functiondef($1::regprocedure) as d`, [fn])).rows[0].d
      expect(def, fn).not.toMatch(/pizza_business_day|\bbusiness_day\b|\bdough_day\b/)
    }
  })
})
