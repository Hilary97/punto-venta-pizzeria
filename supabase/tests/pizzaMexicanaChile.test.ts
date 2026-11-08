// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

let db: TestDb
let cashier: string
let styleIds: Record<string, string>
let nextTable = 1

async function rpc(sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

function portion(style: string, extra: Json = {}) {
  return { style_id: styleIds[style], ingredient_ids: [], extra_ingredient_ids: [], ...extra }
}

async function quoteOf(pizza: Json) {
  await asUser(db, cashier)
  const items = [{ type: 'pizza', quantity: 1, pizza }]
  const orderId = (await rpc('public.create_order($1, $2, $3::jsonb, $4)', [nextTable++, null, JSON.stringify(items), null])).order_id
  return rpc('public.quote_order($1)', [orderId])
}

afterEach(async () => {
  await db.close()
})

describe('Estilo Mexicana chile', () => {
  beforeEach(async () => {
    nextTable = 1
    db = await createTestDb()
    await loadFixture(db)
    await asSuperuser(db)
    const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
    styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
    cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
  }, 60_000)

  it('keeps the 3 chiles when no chile is chosen', async () => {
    const q = await quoteOf({ size: 'chica', portions: [portion('Estilo Mexicana')] })
    expect(q.lines[0].name).toBe('Pizza Chica: Estilo Mexicana (3 chiles)')
  })

  it('describes and stores the chosen chile per portion without changing the price', async () => {
    const plain = await quoteOf({ size: 'grande', portions: [portion('Estilo Mexicana'), portion('Estilo Mexicana')] })
    const chosen = await quoteOf({
      size: 'grande',
      portions: [portion('Estilo Mexicana', { chile: 'morron' }), portion('Estilo Mexicana', { chile: 'jalapeno' })],
    })
    expect(chosen.lines[0].name).toBe('Pizza Grande · Mitades: ½ Estilo Mexicana (Solo morrón) | ½ Estilo Mexicana (Solo jalapeño)')
    expect(chosen.total_cents).toBe(plain.total_cents)

    await asSuperuser(db)
    const stored = await db.query<{ pizza: Json }>(`select pizza from public.order_items where product_name = $1`, [chosen.lines[0].name])
    expect(stored.rows[0].pizza.portions.map((p: Json) => p.chile)).toEqual(['morron', 'jalapeno'])
  })

  it('names serrano and leaves configs without a chile unchanged', async () => {
    await asSuperuser(db)
    const serrano = await rpc('public.validate_pizza($1::jsonb)', [
      JSON.stringify({ size: 'chica', portions: [portion('Estilo Mexicana', { chile: 'serrano' })] }),
    ])
    expect(serrano.portions[0].chile).toBe('serrano')
    expect(await rpc('public.describe_pizza($1::jsonb)', [JSON.stringify(serrano)])).toBe('Pizza Chica: Estilo Mexicana (Solo serrano)')

    const plain = await rpc('public.validate_pizza($1::jsonb)', [
      JSON.stringify({ size: 'chica', portions: [portion('Estilo Mexicana')] }),
    ])
    expect(Object.keys(plain.portions[0])).not.toContain('chile')
  })

  it('rejects a chile on another style or an unknown chile', async () => {
    await asSuperuser(db)
    const other = (
      await db.query<{ name: string }>(
        `select name from public.pizza_styles where kind = 'special' and name <> 'Estilo Mexicana' order by name limit 1`,
      )
    ).rows[0].name
    await expect(
      rpc('public.validate_pizza($1::jsonb)', [JSON.stringify({ size: 'chica', portions: [portion(other, { chile: 'serrano' })] })]),
    ).rejects.toThrow('Solo el Estilo Mexicana permite elegir chile.')
    await expect(
      rpc('public.validate_pizza($1::jsonb)', [
        JSON.stringify({ size: 'chica', portions: [portion('Estilo Mexicana', { chile: 'habanero' })] }),
      ]),
    ).rejects.toThrow('El chile elegido no es válido.')
  })
})
