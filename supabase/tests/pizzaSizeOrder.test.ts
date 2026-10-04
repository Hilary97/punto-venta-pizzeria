// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSuperuser, createTestDb, type TestDb } from './db.ts'

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
  await asSuperuser(db)
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('pizza size order', () => {
  it('lists Grande, Mediana and Chica in that order', async () => {
    const res = await db.query<{ code: string }>(`select code from public.pizza_sizes order by sort_order`)
    expect(res.rows.map((row) => row.code)).toEqual(['grande', 'mediana', 'chica'])
  })
})
