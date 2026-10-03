// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

async function rpc(db: TestDb, sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

const WRONG_PIN = '9999'
const RIGHT_PIN = '1234'
const DEVICE_ERROR = 'Este dispositivo no está autorizado para pedidos.'

let db: TestDb
let fx: Awaited<ReturnType<typeof loadFixture>>

beforeEach(async () => {
  db = await createTestDb()
  fx = await loadFixture(db)
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('supabase migrations', () => {
  it('applies cleanly and creates the expected tables', async () => {
    const res = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    )
    const names = res.rows.map((r) => r.table_name)
    for (const t of ['profiles', 'products', 'sales', 'orders', 'order_items', 'waiters', 'order_devices']) {
      expect(names).toContain(t)
    }
  })

  it('cashier opens a session, creates an order and pays it with server prices', async () => {
    const cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
    await asUser(db, cashier)

    await rpc(db, 'public.open_cash_session($1)', [5000])

    const items = JSON.stringify([
      { product_id: fx.pizzaId, quantity: 2 },
      { product_id: fx.sodaId, quantity: 1 },
    ])
    const created = await rpc(db, 'public.create_order($1, $2, $3::jsonb)', [3, null, items])
    expect(created.order_id).toBeTruthy()

    const named = await rpc(db, 'public.create_order($1, $2, $3::jsonb)', [null, 'Ana', items])
    expect(named.order_id).toBeTruthy()

    const paid = await rpc(db, 'public.pay_order($1, $2)', [created.order_id, 30_000])
    expect(paid.order_id).toBe(created.order_id)

    await asSuperuser(db)
    const sale = await db.query<{ total_cents: number; change_cents: number }>(
      `select total_cents, change_cents from public.sales where id = $1`,
      [paid.sale_id],
    )
    expect(sale.rows[0].total_cents).toBe(2 * 9900 + 2000)
    expect(sale.rows[0].change_cents).toBe(30_000 - (2 * 9900 + 2000))

    const order = await db.query<{ status: string; paid_sale_id: string }>(
      `select status, paid_sale_id from public.orders where id = $1`,
      [created.order_id],
    )
    expect(order.rows[0]).toEqual({ status: 'paid', paid_sale_id: paid.sale_id })
  })

  it('blocks waiter-role profiles from cash and order RPCs', async () => {
    const waiterUser = await createProfile(db, { role: 'waiter', fullName: 'Mesero' })
    await asUser(db, waiterUser)

    await expect(rpc(db, 'public.open_cash_session($1)', [1000])).rejects.toThrow(
      'No tienes permiso para operar la caja.',
    )
    await expect(
      rpc(db, 'public.create_order($1, $2, $3::jsonb)', [
        1,
        null,
        JSON.stringify([{ product_id: fx.pizzaId, quantity: 1 }]),
      ]),
    ).rejects.toThrow('Los pedidos de meseros se registran desde un dispositivo autorizado.')
  })

  describe('waiter devices', () => {
    let secret: string
    let waiterId: string

    beforeEach(async () => {
      const admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
      await asUser(db, admin)
      waiterId = (await rpc(db, 'public.admin_create_waiter($1, $2)', ['Luis', RIGHT_PIN])).waiter_id
      const device = await rpc(db, 'public.admin_register_device($1)', ['Tablet 1'])
      secret = device.device_secret
      expect(secret).toHaveLength(64)
      await asAnon(db)
    })

    it('lists waiters for a valid device secret', async () => {
      const list = await rpc(db, 'public.device_list_waiters($1)', [secret])
      expect(list).toEqual([{ id: waiterId, full_name: 'Luis' }])
    })

    it('rejects wrong PINs, counts attempts and locks after 5', async () => {
      for (let i = 1; i <= 4; i++) {
        const res = await rpc(db, 'public.device_start_shift($1, $2, $3)', [secret, waiterId, WRONG_PIN])
        expect(res.error).toBe('PIN incorrecto.')
        await asSuperuser(db)
        const row = await db.query<{ failed_attempts: number }>(
          `select failed_attempts from public.waiters where id = $1`,
          [waiterId],
        )
        expect(row.rows[0].failed_attempts).toBe(i)
        await asAnon(db)
      }

      const fifth = await rpc(db, 'public.device_start_shift($1, $2, $3)', [secret, waiterId, WRONG_PIN])
      expect(fifth.error).toMatch(/Demasiados intentos/)

      // Locked: even the correct PIN is refused.
      const locked = await rpc(db, 'public.device_start_shift($1, $2, $3)', [secret, waiterId, RIGHT_PIN])
      expect(locked.error).toMatch(/Demasiados intentos/)
      expect(locked.token).toBeUndefined()
    })

    it('starts a shift with the right PIN and records waiter_name on device orders', async () => {
      const shift = await rpc(db, 'public.device_start_shift($1, $2, $3)', [secret, waiterId, RIGHT_PIN])
      expect(shift.token).toBeTruthy()

      const created = await rpc(db, 'public.device_create_order($1, $2, $3, $4, $5::jsonb)', [
        secret,
        shift.token,
        4,
        null,
        JSON.stringify([{ product_id: fx.pizzaId, quantity: 1 }]),
      ])

      await asSuperuser(db)
      const order = await db.query<{ waiter_name: string; waiter_id: string }>(
        `select waiter_name, waiter_id from public.orders where id = $1`,
        [created.order_id],
      )
      expect(order.rows[0]).toEqual({ waiter_name: 'Luis', waiter_id: waiterId })
    })

    it('raises for an invalid device secret', async () => {
      await expect(rpc(db, 'public.device_list_waiters($1)', ['x'.repeat(64)])).rejects.toThrow(DEVICE_ERROR)
      await expect(rpc(db, 'public.device_list_waiters($1)', ['short'])).rejects.toThrow(DEVICE_ERROR)
    })
  })

  it('admin deletes a closed session that contains a paid order', async () => {
    const admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
    await asUser(db, admin)

    const session = await rpc(db, 'public.open_cash_session($1)', [0])
    const order = await rpc(db, 'public.create_order($1, $2, $3::jsonb)', [
      1,
      null,
      JSON.stringify([{ product_id: fx.sodaId, quantity: 1 }]),
    ])
    await rpc(db, 'public.pay_order($1, $2)', [order.order_id, 2000])
    await rpc(db, 'public.close_cash_session($1)', [2000])

    await rpc(db, 'public.delete_closed_cash_session($1)', [session.session_id])

    await asSuperuser(db)
    const left = await db.query<{ n: number }>(
      `select (select count(*) from public.cash_sessions)::int
            + (select count(*) from public.sales)::int
            + (select count(*) from public.orders)::int as n`,
    )
    expect(left.rows[0].n).toBe(0)
  })

  it('denies anon direct reads of orders, waiters and order_devices', async () => {
    for (const table of ['orders', 'waiters', 'order_devices']) {
      await asAnon(db)
      let rows: unknown[] | null = null
      try {
        rows = (await db.query(`select * from public.${table}`)).rows
      } catch (err) {
        expect((err as Error).message).toMatch(/permission denied/)
      }
      if (rows) expect(rows).toHaveLength(0)
    }
  })
})
