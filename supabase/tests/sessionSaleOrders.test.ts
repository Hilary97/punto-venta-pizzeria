// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

async function rpc(db: TestDb, sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

let db: TestDb
let fx: Awaited<ReturnType<typeof loadFixture>>

beforeEach(async () => {
  db = await createTestDb()
  fx = await loadFixture(db)
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('list_session_sale_orders', () => {
  it('returns order info for paid-order sales only, and blocks waiters and anon', async () => {
    const cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
    await asUser(db, cashier)
    const session = await rpc(db, 'public.open_cash_session($1)', [5000])
    const sessionId = (session.session_id ?? session.id) as string

    const items = JSON.stringify([{ product_id: fx.pizzaId, quantity: 1 }])
    const order = await rpc(db, 'public.create_order($1, $2, $3::jsonb)', [4, 'Ana', items])
    const paidOrder = await rpc(db, 'public.pay_order($1, $2)', [order.order_id, 20_000])
    const posSale = await rpc(db, 'public.create_sale($1::jsonb, $2)', [items, 20_000])

    const res = await db.query<{
      sale_id: string
      customer_name: string | null
      table_number: number | null
      waiter_name: string | null
    }>('select * from public.list_session_sale_orders($1)', [sessionId])

    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].sale_id).toBe(paidOrder.sale_id)
    expect(res.rows[0].customer_name).toBe('Ana')
    expect(res.rows[0].table_number).toBe(4)
    expect(res.rows.map((r) => r.sale_id)).not.toContain(posSale.sale_id)

    const waiterUser = await createProfile(db, { role: 'waiter', fullName: 'Mesero' })
    await asUser(db, waiterUser)
    await expect(db.query('select * from public.list_session_sale_orders($1)', [sessionId])).rejects.toThrow(
      'No tienes permiso para operar la caja.',
    )

    await asAnon(db)
    await expect(db.query('select * from public.list_session_sale_orders($1)', [sessionId])).rejects.toThrow()
  })
})
