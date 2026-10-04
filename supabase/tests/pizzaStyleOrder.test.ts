// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSuperuser, createTestDb, type TestDb } from './db.ts'

const MIGRATION = join(import.meta.dirname, '..', 'migrations', '20261012120000_pizza_style_order.sql')

let db: TestDb

async function styleNames() {
  const res = await db.query<{ name: string }>(`select name from public.pizza_styles order by sort_order, name`)
  return res.rows.map((row) => row.name)
}

beforeEach(async () => {
  db = await createTestDb()
  await asSuperuser(db)
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('pizza style order', () => {
  it('keeps the custom style first, then Pepperoni, Hawaiana, Italiana and the rest in their previous order', async () => {
    await db.exec(readFileSync(MIGRATION, 'utf8'))

    const names = await styleNames()
    expect(names.slice(0, 7)).toEqual([
      'Arma tu combinación',
      'Estilo Pepperoni',
      'Estilo Hawaiana',
      'Estilo Italiana',
      'Estilo Varas',
      "Estilo Chuy's",
      'Estilo Seis Carnes',
    ])
    expect(names.at(-1)).toBe('Estilo El Ranchito')
    expect(names).toHaveLength(17)
  })

  it('matches style names regardless of case and spaces', async () => {
    await db.exec(`update public.pizza_styles set name = 'estilo  HAWAIANA ' where name = 'Estilo Hawaiana'`)

    await db.exec(readFileSync(MIGRATION, 'utf8'))

    expect((await styleNames()).slice(0, 3)).toEqual(['Arma tu combinación', 'Estilo Pepperoni', 'estilo  HAWAIANA '])
  })
})
