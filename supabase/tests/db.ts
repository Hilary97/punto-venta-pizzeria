import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations')

// Minimal Supabase-like environment that the migrations assume to exist.
const BOOTSTRAP_SQL = `
create role anon nologin;
create role authenticated nologin;

create schema extensions;
create extension pgcrypto with schema extensions;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

grant usage on schema public, auth, extensions to anon, authenticated;
grant execute on function auth.uid(), auth.role() to anon, authenticated;
`

export type TestDb = PGlite

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(BOOTSTRAP_SQL)

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const file of files) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err })
    }
  }
  return db
}

// Minimal catalog: one category and two active products.
export async function loadFixture(db: TestDb) {
  await asSuperuser(db)
  const cat = await db.query<{ id: string }>(
    `insert into public.categories (name, sort_order) values ('Pizzas', 1) returning id`,
  )
  const products = await db.query<{ id: string; price_cents: number }>(
    `insert into public.products (category_id, name, price_cents, active)
     values ($1, 'Pizza Margarita', 9900, true), ($1, 'Refresco', 2000, true)
     returning id, price_cents`,
    [cat.rows[0].id],
  )
  const [pizza, soda] = products.rows.sort((a, b) => b.price_cents - a.price_cents)
  return { categoryId: cat.rows[0].id, pizzaId: pizza.id, sodaId: soda.id }
}

export async function asSuperuser(db: TestDb) {
  await db.exec('reset role')
}

export async function asUser(db: TestDb, userId: string, role: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)`, [
    userId,
    role,
  ])
  await db.exec(`set role ${role}`)
}

export async function asAnon(db: TestDb) {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'anon', false)`)
  await db.exec('set role anon')
}

export async function createProfile(
  db: TestDb,
  { role, fullName }: { role: string; fullName: string },
): Promise<string> {
  await asSuperuser(db)
  const id = crypto.randomUUID()
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`, [
    id,
    `${id}@test.local`,
    JSON.stringify({ full_name: fullName }),
  ])
  await db.query(`update public.profiles set role = $2 where id = $1`, [id, role])
  return id
}
