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
let admin: string
let cashier: string

/** Turns stock tracking on for a product with the given stock and minimum. */
async function track(productId: string, stock: number, stockMin = 0) {
  await asSuperuser(db)
  await db.query(`update public.products set track_stock = true, stock = $2, stock_min = $3 where id = $1`, [
    productId,
    stock,
    stockMin,
  ])
}

async function stockOf(productId: string): Promise<number> {
  await asSuperuser(db)
  const res = await db.query<{ stock: number }>(`select stock from public.products where id = $1`, [productId])
  return res.rows[0].stock
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

const soda = (quantity: number, notes?: string) => ({ product_id: fx.sodaId, quantity, ...(notes ? { notes } : {}) })

beforeEach(async () => {
  db = await createTestDb()
  fx = await loadFixture(db)
  admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('stock on orders', () => {
  it('leaves untracked products alone', async () => {
    await createOrder([soda(5)])
    expect(await stockOf(fx.sodaId)).toBe(0)
  })

  it('deducts tracked stock when the order is taken and when items are added', async () => {
    await track(fx.sodaId, 24)
    const id = await createOrder([soda(2)])
    expect(await stockOf(fx.sodaId)).toBe(22)
    await addItems(id, [soda(3)])
    expect(await stockOf(fx.sodaId)).toBe(19)
  })

  it('blocks a line asking for more than the stock and rolls back the whole order', async () => {
    await track(fx.sodaId, 2)
    const orders = await countRows('orders')
    const items = await countRows('order_items')
    await expect(createOrder([{ product_id: fx.pizzaId, quantity: 1 }, soda(3)])).rejects.toThrow(
      'No hay suficiente Refresco: quedan 2.',
    )
    expect(await stockOf(fx.sodaId)).toBe(2)
    expect(await countRows('orders')).toBe(orders)
    expect(await countRows('order_items')).toBe(items)
  })

  it('checks the total asked for a product across lines and reports the real stock', async () => {
    await track(fx.sodaId, 23)
    const items = await countRows('order_items')
    await expect(createOrder([soda(12), soda(12, 'Sin hielo')])).rejects.toThrow('No hay suficiente Refresco: quedan 23.')
    expect(await stockOf(fx.sodaId)).toBe(23)
    expect(await countRows('order_items')).toBe(items)
  })

  it('takes stock across several lines of one product when it is enough', async () => {
    await track(fx.sodaId, 23)
    await createOrder([soda(12), soda(11, 'Sin hielo')])
    expect(await stockOf(fx.sodaId)).toBe(0)
  })

  it('blocks a product at zero with the same message', async () => {
    await track(fx.sodaId, 1)
    await createOrder([soda(1)])
    await expect(createOrder([soda(1)], 4)).rejects.toThrow('No hay suficiente Refresco: quedan 0.')
    expect(await stockOf(fx.sodaId)).toBe(0)
  })

  it('blocks adding items beyond the stock without changing the order', async () => {
    await track(fx.sodaId, 3)
    const id = await createOrder([soda(2)])
    const items = await countRows('order_items')
    await expect(addItems(id, [soda(2)])).rejects.toThrow('No hay suficiente Refresco: quedan 1.')
    expect(await stockOf(fx.sodaId)).toBe(1)
    expect(await countRows('order_items')).toBe(items)
  })

  it('restores exactly what the cancelled order took, merged lines and noted lines included', async () => {
    await track(fx.sodaId, 10)
    const id = await createOrder([soda(2)])
    await addItems(id, [soda(1), soda(1, 'Sin hielo')])
    expect(await stockOf(fx.sodaId)).toBe(6)
    await cancel(id)
    expect(await stockOf(fx.sodaId)).toBe(10)
  })

  it('never restores units taken before tracking was switched on', async () => {
    const id = await createOrder([soda(4)])
    await track(fx.sodaId, 10)
    await cancel(id)
    expect(await stockOf(fx.sodaId)).toBe(10)
  })

  it('restores units even if tracking was switched off later', async () => {
    await track(fx.sodaId, 10)
    const id = await createOrder([soda(4)])
    await asSuperuser(db)
    await db.query(`update public.products set track_stock = false where id = $1`, [fx.sodaId])
    await cancel(id)
    expect(await stockOf(fx.sodaId)).toBe(10)
  })

  it('does not deduct again when the order is paid', async () => {
    await track(fx.sodaId, 10)
    await asUser(db, cashier)
    await rpc(db, 'public.open_cash_session($1)', [5000])
    const id = await createOrder([soda(2)])
    await asUser(db, cashier)
    await rpc(db, 'public.pay_order($1, $2)', [id, 10_000])
    expect(await stockOf(fx.sodaId)).toBe(8)
  })

  it('never lets stock go negative even when written directly', async () => {
    await track(fx.sodaId, 1)
    await asSuperuser(db)
    await expect(db.query(`update public.products set stock = -1 where id = $1`, [fx.sodaId])).rejects.toThrow()
    await expect(db.query(`update public.products set stock_min = -1 where id = $1`, [fx.sodaId])).rejects.toThrow()
  })
})

describe('admin stock RPCs', () => {
  it('adds received units', async () => {
    await track(fx.sodaId, 5)
    await asUser(db, admin)
    const res = await rpc(db, 'public.admin_receive_stock($1, $2)', [fx.sodaId, 24])
    expect(res).toEqual({ product_id: fx.sodaId, stock: 29 })
    expect(await stockOf(fx.sodaId)).toBe(29)
  })

  it('sets the counted stock', async () => {
    await track(fx.sodaId, 5)
    await asUser(db, admin)
    const res = await rpc(db, 'public.admin_count_stock($1, $2)', [fx.sodaId, 17])
    expect(res).toEqual({ product_id: fx.sodaId, stock: 17 })
    expect(await stockOf(fx.sodaId)).toBe(17)
  })

  it('rejects invalid quantities and leaves the stock unchanged', async () => {
    await track(fx.sodaId, 5)
    await asUser(db, admin)
    await expect(rpc(db, 'public.admin_receive_stock($1, $2)', [fx.sodaId, 0])).rejects.toThrow(
      'La cantidad debe ser mayor a cero.',
    )
    await expect(rpc(db, 'public.admin_receive_stock($1, $2)', [fx.sodaId, null])).rejects.toThrow(
      'La cantidad debe ser mayor a cero.',
    )
    await expect(rpc(db, 'public.admin_count_stock($1, $2)', [fx.sodaId, -1])).rejects.toThrow(
      'El conteo no puede ser negativo.',
    )
    await expect(rpc(db, 'public.admin_count_stock($1, $2)', [fx.sodaId, null])).rejects.toThrow(
      'El conteo no puede ser negativo.',
    )
    expect(await stockOf(fx.sodaId)).toBe(5)
  })

  it('rejects products without tracking or unknown products', async () => {
    await asUser(db, admin)
    await expect(rpc(db, 'public.admin_receive_stock($1, $2)', [fx.sodaId, 3])).rejects.toThrow(
      'El producto no controla inventario.',
    )
    await expect(rpc(db, 'public.admin_count_stock($1, $2)', [crypto.randomUUID(), 3])).rejects.toThrow(
      'El producto no controla inventario.',
    )
    expect(await stockOf(fx.sodaId)).toBe(0)
  })

  it('is admin only', async () => {
    await track(fx.sodaId, 5)
    await asUser(db, cashier)
    await expect(rpc(db, 'public.admin_receive_stock($1, $2)', [fx.sodaId, 3])).rejects.toThrow(
      'Solo un administrador puede ajustar el inventario.',
    )
    await expect(rpc(db, 'public.admin_count_stock($1, $2)', [fx.sodaId, 3])).rejects.toThrow(
      'Solo un administrador puede ajustar el inventario.',
    )
    await asAnon(db)
    await expect(rpc(db, 'public.admin_receive_stock($1, $2)', [fx.sodaId, 3])).rejects.toThrow()
    expect(await stockOf(fx.sodaId)).toBe(5)
  })
})

describe('catalog stock fields', () => {
  it('device catalog exposes track_stock and stock per product', async () => {
    await track(fx.sodaId, 7)
    await asUser(db, admin)
    const secret = (await rpc(db, 'public.admin_register_device($1)', ['Tablet 1'])).device_secret
    await asAnon(db)
    const catalog = await rpc(db, 'public.device_list_catalog($1)', [secret])
    const bySoda = catalog.products.find((p: Json) => p.id === fx.sodaId)
    const byPizza = catalog.products.find((p: Json) => p.id === fx.pizzaId)
    expect(bySoda).toMatchObject({ track_stock: true, stock: 7 })
    expect(byPizza).toMatchObject({ track_stock: false, stock: 0 })
  })
})
