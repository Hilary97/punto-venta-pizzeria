// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

let db: TestDb
let styleIds: Record<string, string>
let ingredientIds: Record<string, string>
let extraIngredientCents: number

function portion(style: string, ingredients: string[] = [], extras: string[] = []) {
  return {
    style_id: styleIds[style],
    ingredient_ids: ingredients.map((name) => ingredientIds[name]),
    extra_ingredient_ids: extras.map((name) => ingredientIds[name]),
  }
}

async function priced(config: Json): Promise<{ price: number; text: string }> {
  await asSuperuser(db)
  const res = await db.query<{ price: number; text: string }>(
    `select public.price_pizza(c) as price, public.describe_pizza(c) as text
     from (select public.validate_pizza($1::jsonb) as c) v`,
    [JSON.stringify(config)],
  )
  return res.rows[0]
}

async function stylePrice(style: string, size: string): Promise<number> {
  await asSuperuser(db)
  const res = await db.query<{ c: number }>(
    `select price_cents as c from public.pizza_style_prices where style_id = $1 and size_code = $2`,
    [styleIds[style], size],
  )
  return res.rows[0].c
}

afterEach(async () => {
  await db.close()
})

// Every style, specials included, has 2 ingredients of the customer's choice in its price.
describe('included ingredients on every style', () => {
  beforeEach(async () => {
    db = await createTestDb()
    await loadFixture(db)
    await asSuperuser(db)
    const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
    styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
    const ingredients = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_ingredients`)
    ingredientIds = Object.fromEntries(ingredients.rows.map((r) => [r.name, r.id]))
    extraIngredientCents = (
      await db.query<{ c: number }>(`select extra_ingredient_cents as c from public.pizza_settings`)
    ).rows[0].c
  }, 60_000)

  it('gives every style 2 included ingredients', async () => {
    const res = await db.query<{ name: string; included_ingredients: number }>(
      `select name, included_ingredients from public.pizza_styles where included_ingredients <> 2`,
    )
    expect(res.rows).toEqual([])
  })

  it('charges a special style with 2 chosen ingredients its plain price', async () => {
    const result = await priced({ size: 'grande', portions: [portion('Estilo Varas', ['Jamón', 'Piña'])] })

    expect(result.price).toBe(await stylePrice('Estilo Varas', 'grande'))
    expect(result.text).toBe('Pizza Grande: Estilo Varas (Jamón, Piña)')
  })

  it('charges a third ingredient on a special style as an extra ingredient', async () => {
    const result = await priced({
      size: 'grande',
      portions: [portion('Estilo Varas', ['Jamón', 'Piña'], ['Ajo'])],
    })

    expect(result.price).toBe((await stylePrice('Estilo Varas', 'grande')) + extraIngredientCents)
    expect(result.text).toBe('Pizza Grande: Estilo Varas (Jamón, Piña) + Ajo')
  })

  it('still accepts a special style with no chosen ingredients', async () => {
    const result = await priced({ size: 'chica', portions: [portion('Estilo Varas')] })

    expect(result.price).toBe(await stylePrice('Estilo Varas', 'chica'))
    expect(result.text).toBe('Pizza Chica: Estilo Varas')
  })

  it('rejects more than 2 included ingredients on a special style', async () => {
    await expect(
      priced({ size: 'grande', portions: [portion('Estilo Varas', ['Jamón', 'Piña', 'Ajo'])] }),
    ).rejects.toThrow('Estilo Varas incluye hasta 2 ingredientes.')
  })

  it('gives each half of a split pizza its own 2 included ingredients', async () => {
    const result = await priced({
      size: 'grande',
      portions: [portion('Estilo Varas', ['Jamón', 'Piña']), portion("Estilo Chuy's", ['Ajo', 'Jamón'])],
    })

    const average = Math.ceil(((await stylePrice('Estilo Varas', 'grande')) + (await stylePrice("Estilo Chuy's", 'grande'))) / 2 / 2500) * 2500
    expect(result.price).toBe(average)
  })

  it('lets the admin keep 0-4 included ingredients on a special style', async () => {
    const admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
    const save = async (included: number) => {
      await asUser(db, admin)
      const res = await db.query<{ r: Json }>(
        `select public.admin_save_pizza_style(null, $1, '', 'special', $2, 30, true,
          '{"chica": 11000, "mediana": 19000, "grande": 21000}'::jsonb) as r`,
        [`Estilo ${included}`, included],
      )
      await asSuperuser(db)
      const row = await db.query<{ n: number }>(`select included_ingredients as n from public.pizza_styles where id = $1`, [
        res.rows[0].r.style_id,
      ])
      return row.rows[0].n
    }

    expect(await save(2)).toBe(2)
    expect(await save(0)).toBe(0)
    expect(await save(4)).toBe(4)
    await expect(save(5)).rejects.toThrow('Los ingredientes incluidos deben estar entre 0 y 4.')
  })
})
