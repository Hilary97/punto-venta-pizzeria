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

async function dayRow(size: string): Promise<{ prepared: number; used: number } | undefined> {
  await asSuperuser(db)
  const res = await db.query<{ prepared: number; used: number }>(
    `select prepared, used from public.pizza_dough_days where business_day = public.pizza_business_day() and size_code = $1`,
    [size],
  )
  return res.rows[0]
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

async function doughDays(orderId: string): Promise<(string | null)[]> {
  await asSuperuser(db)
  const res = await db.query<{ d: string | null }>(
    `select dough_day::text as d from public.order_items where order_id = $1 order by id`,
    [orderId],
  )
  return res.rows.map((r) => r.d)
}

async function today(): Promise<string> {
  await asSuperuser(db)
  return (await db.query<{ d: string }>(`select public.pizza_business_day()::text as d`)).rows[0].d
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

  it('restores to the business day the line took, not to today', async () => {
    await setDough('chica', 5)
    const id = await createOrder([pizza('chica', 2)])
    await asSuperuser(db)
    await db.query(`update public.pizza_dough_days set business_day = business_day - 1`)
    await db.query(`update public.order_items set dough_day = dough_day - 1 where order_id = $1`, [id])
    await db.query(`insert into public.pizza_dough_days (business_day, size_code, prepared, used) values (public.pizza_business_day(), 'chica', 4, 1)`)
    await cancel(id)
    await asSuperuser(db)
    const rows = await db.query<{ d: string; used: number }>(
      `select business_day::text as d, used from public.pizza_dough_days order by business_day`,
    )
    expect(rows.rows.map((r) => r.used)).toEqual([0, 1])
  })
})

describe('admin_set_pizza_dough', () => {
  it("creates today's row and returns the numbers", async () => {
    const res = await setDough('mediana', 12)
    expect(res).toMatchObject({ business_day: await today(), size_code: 'mediana', prepared: 12, used: 0, left: 12 })
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
    expect(res.business_day).toBe(await today())
    expect(res.sizes).toEqual([
      { size_code: 'grande', name: 'Grande', prepared: null, used: null, left: null },
      { size_code: 'mediana', name: 'Mediana', prepared: 8, used: 3, left: 5 },
      { size_code: 'chica', name: 'Chica', prepared: null, used: null, left: null },
    ])
  })

  it('ignores rows of other business days', async () => {
    await setDough('chica', 5)
    await asSuperuser(db)
    await db.query(`update public.pizza_dough_days set business_day = business_day - 1`)
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
      db.query(`insert into public.pizza_dough_days (business_day, size_code, prepared) values (current_date, 'grande', 5)`),
    ).rejects.toThrow()
    await expect(db.query(`delete from public.pizza_dough_days`)).rejects.toThrow()

    for (const uid of [cashier, waiter]) {
      await asUser(db, uid)
      expect((await db.query(`select * from public.pizza_dough_days`)).rows).toHaveLength(0)
      await expect(db.query(`update public.pizza_dough_days set prepared = 99`)).rejects.toThrow()
      await expect(
        db.query(`insert into public.pizza_dough_days (business_day, size_code, prepared) values (current_date, 'grande', 5)`),
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
      db.query(`insert into public.pizza_dough_days (business_day, size_code, prepared, used) values (current_date, 'chica', 1, 2)`),
    ).rejects.toThrow()
    await expect(
      db.query(`insert into public.pizza_dough_days (business_day, size_code, prepared, used) values (current_date, 'chica', -1, 0)`),
    ).rejects.toThrow()
  })
})
