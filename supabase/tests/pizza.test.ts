// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAnon, asSuperuser, asUser, createProfile, createTestDb, loadFixture, type TestDb } from './db.ts'

type Json = Record<string, any>

async function rpc(db: TestDb, sql: string, params: unknown[] = []): Promise<Json> {
  const res = await db.query<{ r: Json }>(`select ${sql} as r`, params)
  return res.rows[0].r
}

type PortionSpec = { style: string; ingredients?: string[]; extras?: string[]; cheese?: boolean }

const CUSTOM = 'Arma tu combinación'

let db: TestDb
let fx: Awaited<ReturnType<typeof loadFixture>>
let styleIds: Record<string, string>
let ingredientIds: Record<string, string>
let cashier: string

function pizzaConfig(size: string, portions: PortionSpec[]) {
  return {
    size,
    portions: portions.map((p) => ({
      style_id: styleIds[p.style],
      ingredient_ids: (p.ingredients ?? []).map((n) => ingredientIds[n]),
      extra_ingredient_ids: (p.extras ?? []).map((n) => ingredientIds[n]),
      extra_cheese: p.cheese ?? false,
    })),
  }
}

function pizzaLine(size: string, portions: PortionSpec[], extra: Json = {}) {
  return { type: 'pizza', pizza: pizzaConfig(size, portions), quantity: 1, ...extra }
}

async function createOrder(items: Json[], notes: string | null = null) {
  await asUser(db, cashier)
  const res = await rpc(db, 'public.create_order($1, $2, $3::jsonb, $4)', [3, null, JSON.stringify(items), notes])
  return res.order_id as string
}

async function quote(orderId: string) {
  await asUser(db, cashier)
  return rpc(db, 'public.quote_order($1)', [orderId])
}

async function quoteTotal(items: Json[]) {
  const q = await quote(await createOrder(items))
  return q.total_cents as number
}

async function validate(config: unknown) {
  await asSuperuser(db)
  return rpc(db, 'public.validate_pizza($1::jsonb)', [JSON.stringify(config)])
}

beforeEach(async () => {
  db = await createTestDb()
  fx = await loadFixture(db)
  await asSuperuser(db)
  const styles = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_styles`)
  styleIds = Object.fromEntries(styles.rows.map((r) => [r.name, r.id]))
  const ings = await db.query<{ id: string; name: string }>(`select id, name from public.pizza_ingredients`)
  ingredientIds = Object.fromEntries(ings.rows.map((r) => [r.name, r.id]))
  cashier = await createProfile(db, { role: 'cashier', fullName: 'Caja' })
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('pizza catalog seed', () => {
  it('seeds styles, ingredients, prices and settings', async () => {
    await asSuperuser(db)
    const counts = await db.query<Record<string, number>>(
      `select (select count(*) from public.pizza_styles)::int as styles,
              (select count(*) from public.pizza_ingredients)::int as ingredients,
              (select count(*) from public.pizza_style_prices)::int as prices,
              (select count(*) from public.pizza_sizes)::int as sizes`,
    )
    expect(counts.rows[0]).toEqual({ styles: 17, ingredients: 15, prices: 51, sizes: 3 })

    const settings = await db.query(`select extra_ingredient_cents, extra_cheese_cents from public.pizza_settings`)
    expect(settings.rows).toEqual([{ extra_ingredient_cents: 500, extra_cheese_cents: 3000 }])
  })

  it('seeds Hawaiana, Italiana and Pepperoni at 210/190/110 (grande/mediana/chica)', async () => {
    await asSuperuser(db)
    const res = await db.query<Record<string, unknown>>(
      `select s.name, s.description, s.kind, s.sort_order,
              array_agg(p.price_cents order by z.sort_order) as prices
       from public.pizza_styles s
       join public.pizza_style_prices p on p.style_id = s.id
       join public.pizza_sizes z on z.code = p.size_code
       where s.name in ('Estilo Hawaiana', 'Estilo Italiana', 'Estilo Pepperoni')
       group by s.id
       order by s.sort_order`,
    )
    expect(res.rows).toEqual([
      { name: 'Estilo Pepperoni', description: 'Pepperoni', kind: 'special', sort_order: 2, prices: [21000, 19000, 11000] },
      { name: 'Estilo Hawaiana', description: 'Jamón y piña', kind: 'special', sort_order: 3, prices: [21000, 19000, 11000] },
      { name: 'Estilo Italiana', description: 'Pepperoni y champiñón', kind: 'special', sort_order: 4, prices: [21000, 19000, 11000] },
    ])
  })
})

describe('validate_pizza', () => {
  it('rejects dividing a chica pizza', async () => {
    await expect(
      validate(pizzaConfig('chica', [{ style: 'Estilo Varas' }, { style: "Estilo Chuy's" }])),
    ).rejects.toThrow('La pizza Chica no se puede dividir en 2 porciones.')
  })

  it('allows mitades but not tercios on mediana', async () => {
    await expect(
      validate(pizzaConfig('mediana', [{ style: 'Estilo Varas' }, { style: "Estilo Chuy's" }])),
    ).resolves.toBeTruthy()
    await expect(
      validate(pizzaConfig('mediana', [{ style: 'Estilo Varas' }, { style: "Estilo Chuy's" }, { style: 'Estilo Suprema' }])),
    ).rejects.toThrow('La pizza Mediana no se puede dividir en 3 porciones.')
  })

  it('allows tercios and cuartos on grande', async () => {
    const three = [{ style: 'Estilo Varas' }, { style: "Estilo Chuy's" }, { style: 'Estilo Suprema' }]
    await expect(validate(pizzaConfig('grande', three))).resolves.toBeTruthy()
    await expect(validate(pizzaConfig('grande', [...three, { style: 'Estilo Mexicana' }]))).resolves.toBeTruthy()
  })

  it('rejects an unknown size', async () => {
    await expect(validate(pizzaConfig('gigante', [{ style: 'Estilo Varas' }]))).rejects.toThrow('Tamaño de pizza inválido.')
  })

  it('rejects ingredient_ids on a special style', async () => {
    await expect(
      validate(pizzaConfig('grande', [{ style: 'Estilo Varas', ingredients: ['Jamón'] }])),
    ).rejects.toThrow()
  })

  it('rejects a custom portion with 3 ingredients', async () => {
    await expect(
      validate(pizzaConfig('grande', [{ style: CUSTOM, ingredients: ['Jamón', 'Piña', 'Ajo'] }])),
    ).rejects.toThrow('Arma tu combinación incluye hasta 2 ingredientes.')
  })

  it('rejects a custom portion with no ingredients', async () => {
    await expect(validate(pizzaConfig('grande', [{ style: CUSTOM }]))).rejects.toThrow(
      'Elige al menos un ingrediente para Arma tu combinación.',
    )
  })

  it('rejects an inactive style', async () => {
    await asSuperuser(db)
    await db.query(`update public.pizza_styles set active = false where name = 'Estilo Varas'`)
    await expect(validate(pizzaConfig('grande', [{ style: 'Estilo Varas' }]))).rejects.toThrow(
      'Uno de los estilos no existe o no está activo.',
    )
  })

  it('rejects an inactive extra ingredient', async () => {
    await asSuperuser(db)
    await db.query(`update public.pizza_ingredients set active = false where name = 'Ajo'`)
    await expect(validate(pizzaConfig('grande', [{ style: 'Estilo Varas', extras: ['Ajo'] }]))).rejects.toThrow(
      'Uno de los ingredientes no existe o no está activo.',
    )
  })

  it('rejects a malformed style id with a friendly message', async () => {
    await expect(
      validate({ size: 'grande', portions: [{ style_id: 'nope', ingredient_ids: [], extra_ingredient_ids: [] }] }),
    ).rejects.toThrow('La configuración de la pizza es inválida.')
  })
})

describe('quote_order pricing', () => {
  it('charges the most expensive style: grande ½ Varas + ½ Chuy\'s', async () => {
    expect(await quoteTotal([pizzaLine('grande', [{ style: 'Estilo Varas' }, { style: "Estilo Chuy's" }])])).toBe(25000)
  })

  it('adds an extra ingredient on one half', async () => {
    expect(
      await quoteTotal([
        pizzaLine('grande', [{ style: 'Estilo Varas', extras: ['Jalapeños'] }, { style: "Estilo Chuy's" }]),
      ]),
    ).toBe(25500)
  })

  it('adds extra cheese on both halves', async () => {
    expect(
      await quoteTotal([
        pizzaLine('grande', [
          { style: 'Estilo Varas', extras: ['Jalapeños'], cheese: true },
          { style: "Estilo Chuy's", cheese: true },
        ]),
      ]),
    ).toBe(31500)
  })

  it('prices a mediana custom combination', async () => {
    expect(
      await quoteTotal([pizzaLine('mediana', [{ style: CUSTOM, ingredients: ['Jamón', 'Piña'] }])]),
    ).toBe(19000)
  })

  it('prices a chica Chuley with 2 extras', async () => {
    expect(
      await quoteTotal([pizzaLine('chica', [{ style: 'Estilo Chuley', extras: ['Ajo', 'Aceituna negra'] }])]),
    ).toBe(19000)
  })

  it('multiplies by quantity', async () => {
    const line = pizzaLine('grande', [{ style: 'Estilo Varas' }, { style: "Estilo Chuy's" }], { quantity: 2 })
    const q = await quote(await createOrder([line]))
    expect(q.total_cents).toBe(50000)
    expect(q.lines[0].unit_price_cents).toBe(25000)
    expect(q.lines[0].line_total_cents).toBe(50000)
    expect(q.payable).toBe(true)
  })

  it('quotes products at the current price', async () => {
    const q = await quote(await createOrder([{ product_id: fx.sodaId, quantity: 3 }]))
    expect(q.total_cents).toBe(6000)
    expect(q.lines[0]).toMatchObject({ item_type: 'product', name: 'Refresco', quantity: 3, available: true })
  })

  it('describes the pizza in the quote line', async () => {
    const q = await quote(
      await createOrder([pizzaLine('grande', [{ style: 'Estilo Varas', extras: ['Jalapeños'] }, { style: "Estilo Chuy's" }])]),
    )
    expect(q.lines[0].name).toBe("Pizza Grande · Mitades: ½ Estilo Varas + Jalapeños | ½ Estilo Chuy's")
  })
})

describe('describe_pizza', () => {
  it('formats mitades with extras', async () => {
    await asSuperuser(db)
    const config = await validate(
      pizzaConfig('grande', [{ style: 'Estilo Varas', extras: ['Jalapeños'] }, { style: "Estilo Chuy's" }]),
    )
    const text = await rpc(db, 'public.describe_pizza($1::jsonb)', [JSON.stringify(config)])
    expect(text).toBe("Pizza Grande · Mitades: ½ Estilo Varas + Jalapeños | ½ Estilo Chuy's")
  })

  it('formats a whole custom pizza with extra cheese', async () => {
    const config = await validate(
      pizzaConfig('mediana', [{ style: CUSTOM, ingredients: ['Piña', 'Jamón'], cheese: true }]),
    )
    const text = await rpc(db, 'public.describe_pizza($1::jsonb)', [JSON.stringify(config)])
    expect(text).toBe('Pizza Mediana: Arma tu combinación (Jamón, Piña) + Extra queso')
  })

  it('uses tercios and cuartos labels', async () => {
    const three = await validate(
      pizzaConfig('grande', [{ style: 'Estilo Varas' }, { style: "Estilo Chuy's" }, { style: 'Estilo Suprema' }]),
    )
    expect(await rpc(db, 'public.describe_pizza($1::jsonb)', [JSON.stringify(three)])).toBe(
      "Pizza Grande · Tercios: ⅓ Estilo Varas | ⅓ Estilo Chuy's | ⅓ Estilo Suprema",
    )
    const four = await validate(pizzaConfig('grande', Array(4).fill({ style: 'Estilo Varas' })))
    expect(await rpc(db, 'public.describe_pizza($1::jsonb)', [JSON.stringify(four)])).toMatch(/· Cuartos: ¼ Estilo Varas/)
  })
})

describe('order lines and notes', () => {
  async function items(orderId: string) {
    await asSuperuser(db)
    const res = await db.query<{ item_type: string; product_id: string | null; quantity: number; notes: string | null; product_name: string }>(
      `select item_type, product_id, quantity, notes, product_name from public.order_items where order_id = $1 order by notes nulls first`,
      [orderId],
    )
    return res.rows
  }

  it('merges product lines without notes', async () => {
    const id = await createOrder([
      { product_id: fx.sodaId, quantity: 1 },
      { type: 'product', product_id: fx.sodaId, quantity: 2 },
    ])
    const rows = await items(id)
    expect(rows).toHaveLength(1)
    expect(rows[0].quantity).toBe(3)
  })

  it('does not merge a product line with notes into one without', async () => {
    const id = await createOrder([
      { product_id: fx.sodaId, quantity: 1 },
      { product_id: fx.sodaId, quantity: 1, notes: '  sin hielo ' },
    ])
    const rows = await items(id)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.notes)).toEqual([null, 'sin hielo'])
  })

  it('stores pizza rows separately with canonical config and description', async () => {
    const line = pizzaLine('grande', [{ style: 'Estilo Varas' }])
    const id = await createOrder([line, line])
    const rows = await items(id)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ item_type: 'pizza', product_id: null, product_name: 'Pizza Grande: Estilo Varas' })
  })

  it('rejects a too-long line note and treats blank notes as null', async () => {
    await asUser(db, cashier)
    await expect(
      rpc(db, 'public.create_order($1, $2, $3::jsonb)', [
        1,
        null,
        JSON.stringify([{ product_id: fx.sodaId, quantity: 1, notes: 'x'.repeat(201) }]),
      ]),
    ).rejects.toThrow('La nota es demasiado larga.')

    const id = await createOrder([{ product_id: fx.sodaId, quantity: 1, notes: '   ' }])
    expect((await items(id))[0].notes).toBeNull()
  })

  it('stores order notes and updates them with set_order_notes', async () => {
    const id = await createOrder([{ product_id: fx.sodaId, quantity: 1 }], '  Para llevar ')
    await asSuperuser(db)
    const first = await db.query<{ notes: string | null }>(`select notes from public.orders where id = $1`, [id])
    expect(first.rows[0].notes).toBe('Para llevar')

    await asUser(db, cashier)
    await rpc(db, 'public.set_order_notes($1, $2)', [id, 'Sin cebolla'])
    await asSuperuser(db)
    const second = await db.query<{ notes: string | null }>(`select notes from public.orders where id = $1`, [id])
    expect(second.rows[0].notes).toBe('Sin cebolla')

    await asUser(db, cashier)
    await rpc(db, 'public.set_order_notes($1, $2)', [id, '  '])
    await asSuperuser(db)
    const third = await db.query<{ notes: string | null }>(`select notes from public.orders where id = $1`, [id])
    expect(third.rows[0].notes).toBeNull()
  })

  it('add_order_items accepts pizza lines', async () => {
    const id = await createOrder([{ product_id: fx.sodaId, quantity: 1 }])
    await asUser(db, cashier)
    await rpc(db, 'public.add_order_items($1, $2::jsonb)', [id, JSON.stringify([pizzaLine('chica', [{ style: 'Estilo Varas' }])])])
    expect(await items(id)).toHaveLength(2)
  })
})

describe('pay_order', () => {
  const pizzaForPay = () =>
    pizzaLine('grande', [{ style: 'Estilo Varas', extras: ['Jalapeños'] }, { style: "Estilo Chuy's" }], {
      notes: 'bien cocida',
    })

  it('creates a sale equal to the quote and marks the order paid', async () => {
    const id = await createOrder([pizzaForPay(), { product_id: fx.sodaId, quantity: 2 }])
    const q = await quote(id)
    expect(q.total_cents).toBe(25500 + 4000)

    await asUser(db, cashier)
    await rpc(db, 'public.open_cash_session($1)', [0])
    const paid = await rpc(db, 'public.pay_order($1, $2)', [id, 30_000])
    expect(paid).toMatchObject({ total_cents: q.total_cents, change_cents: 500, order_id: id })

    await asSuperuser(db)
    const sale = await db.query<{ total_cents: number; received_cents: number }>(
      `select total_cents, received_cents from public.sales where id = $1`,
      [paid.sale_id],
    )
    expect(sale.rows[0]).toEqual({ total_cents: q.total_cents, received_cents: 30_000 })

    const lines = await db.query<{ product_id: string | null; product_name: string; unit_price_cents: number; quantity: number }>(
      `select product_id, product_name, unit_price_cents, quantity from public.sale_items where sale_id = $1 order by unit_price_cents desc`,
      [paid.sale_id],
    )
    expect(lines.rows).toEqual([
      {
        product_id: null,
        product_name: "Pizza Grande · Mitades: ½ Estilo Varas + Jalapeños | ½ Estilo Chuy's — Nota: bien cocida",
        unit_price_cents: 25500,
        quantity: 1,
      },
      { product_id: fx.sodaId, product_name: 'Refresco', unit_price_cents: 2000, quantity: 2 },
    ])

    const order = await db.query<{ status: string; paid_sale_id: string }>(
      `select status, paid_sale_id from public.orders where id = $1`,
      [id],
    )
    expect(order.rows[0]).toEqual({ status: 'paid', paid_sale_id: paid.sale_id })
  })

  it('appends the note to product lines too', async () => {
    const id = await createOrder([{ product_id: fx.sodaId, quantity: 1, notes: 'sin hielo' }])
    await asUser(db, cashier)
    await rpc(db, 'public.open_cash_session($1)', [0])
    const paid = await rpc(db, 'public.pay_order($1, $2)', [id, 2000])
    await asSuperuser(db)
    const lines = await db.query<{ product_name: string }>(`select product_name from public.sale_items where sale_id = $1`, [
      paid.sale_id,
    ])
    expect(lines.rows[0].product_name).toBe('Refresco — Nota: sin hielo')
  })

  it('rejects insufficient cash and leaves the order open', async () => {
    const id = await createOrder([pizzaForPay()])
    await asUser(db, cashier)
    await rpc(db, 'public.open_cash_session($1)', [0])
    await expect(rpc(db, 'public.pay_order($1, $2)', [id, 100])).rejects.toThrow(
      'El monto recibido es menor al total de la venta.',
    )
    await asSuperuser(db)
    const order = await db.query<{ status: string }>(`select status from public.orders where id = $1`, [id])
    expect(order.rows[0].status).toBe('open')
  })

  it('rejects payment without an open cash session', async () => {
    const id = await createOrder([pizzaForPay()])
    await asUser(db, cashier)
    await expect(rpc(db, 'public.pay_order($1, $2)', [id, 99_999])).rejects.toThrow(
      'No hay una caja abierta. Abre la caja antes de vender.',
    )
  })

  it('blocks waiter-role profiles from quoting and paying', async () => {
    const id = await createOrder([{ product_id: fx.sodaId, quantity: 1 }])
    const waiter = await createProfile(db, { role: 'waiter', fullName: 'Mesero' })
    await asUser(db, waiter)
    await expect(rpc(db, 'public.quote_order($1)', [id])).rejects.toThrow('No tienes permiso para cobrar pedidos.')
    await expect(rpc(db, 'public.pay_order($1, $2)', [id, 5000])).rejects.toThrow('No tienes permiso para cobrar pedidos.')
  })

  it('rejects quoting an unknown order', async () => {
    await asUser(db, cashier)
    await expect(rpc(db, 'public.quote_order($1)', [crypto.randomUUID()])).rejects.toThrow('El pedido no existe.')
  })

  it('marks lines unavailable when a style is deactivated and refuses to pay', async () => {
    const id = await createOrder([pizzaLine('grande', [{ style: 'Estilo Varas' }]), { product_id: fx.sodaId, quantity: 1 }])
    await asSuperuser(db)
    await db.query(`update public.pizza_styles set active = false where name = 'Estilo Varas'`)

    const q = await quote(id)
    expect(q.payable).toBe(false)
    const pizza = q.lines.find((l: Json) => l.item_type === 'pizza')
    expect(pizza).toMatchObject({ available: false, unit_price_cents: null })
    expect(pizza.reason).toBe('Uno de los estilos no existe o no está activo.')
    expect(q.total_cents).toBe(2000)

    await asUser(db, cashier)
    await rpc(db, 'public.open_cash_session($1)', [0])
    await expect(rpc(db, 'public.pay_order($1, $2)', [id, 99_999])).rejects.toThrow(
      /Hay productos no disponibles en el pedido: .*Corrígelo en Pedidos\./,
    )
  })

  it('marks product lines unavailable when the product is deactivated', async () => {
    const id = await createOrder([{ product_id: fx.sodaId, quantity: 1 }])
    await asSuperuser(db)
    await db.query(`update public.products set active = false where id = $1`, [fx.sodaId])
    const q = await quote(id)
    expect(q.lines[0]).toMatchObject({ available: false, reason: 'Producto no disponible' })
    expect(q.payable).toBe(false)
  })
})

describe('device flow', () => {
  let secret: string
  let token: string

  beforeEach(async () => {
    const admin = await createProfile(db, { role: 'admin', fullName: 'Admin' })
    await asUser(db, admin)
    const waiterId = (await rpc(db, 'public.admin_create_waiter($1, $2)', ['Luis', '1234'])).waiter_id
    secret = (await rpc(db, 'public.admin_register_device($1)', ['Tablet 1'])).device_secret
    await asAnon(db)
    token = (await rpc(db, 'public.device_start_shift($1, $2, $3)', [secret, waiterId, '1234'])).token
  })

  it('creates an order with a pizza line and order notes, then edits the notes', async () => {
    const created = await rpc(db, 'public.device_create_order($1, $2, $3, $4, $5::jsonb, $6)', [
      secret,
      token,
      2,
      null,
      JSON.stringify([pizzaLine('grande', [{ style: 'Estilo Varas' }, { style: "Estilo Chuy's" }], { notes: 'cortada en 8' })]),
      'Sin picante',
    ])
    expect(created.order_id).toBeTruthy()

    const set = await rpc(db, 'public.device_set_order_notes($1, $2, $3, $4)', [secret, token, created.order_id, 'Mesa junto a la ventana'])
    expect(set.order_id).toBe(created.order_id)

    const open = await rpc(db, 'public.device_list_open_orders($1)', [secret])
    expect(open).toHaveLength(1)
    expect(open[0].notes).toBe('Mesa junto a la ventana')
    expect(open[0].order_items[0]).toMatchObject({
      item_type: 'pizza',
      product_id: null,
      notes: 'cortada en 8',
      product_name: "Pizza Grande · Mitades: ½ Estilo Varas | ½ Estilo Chuy's",
    })
    expect(open[0].order_items[0].pizza.size).toBe('grande')
    expect(open[0].order_items[0].pizza.portions).toHaveLength(2)
  })

  it('rejects device_set_order_notes with an invalid shift', async () => {
    const created = await rpc(db, 'public.device_create_order($1, $2, $3, $4, $5::jsonb)', [
      secret,
      token,
      2,
      null,
      JSON.stringify([{ product_id: fx.sodaId, quantity: 1 }]),
    ])
    await expect(
      rpc(db, 'public.device_set_order_notes($1, $2, $3, $4)', [secret, crypto.randomUUID(), created.order_id, 'x']),
    ).rejects.toThrow('Tu turno expiró. Ingresa tu PIN de nuevo.')
  })

  it('device_add_order_items accepts pizza lines', async () => {
    const created = await rpc(db, 'public.device_create_order($1, $2, $3, $4, $5::jsonb)', [
      secret,
      token,
      2,
      null,
      JSON.stringify([{ product_id: fx.sodaId, quantity: 1 }]),
    ])
    await rpc(db, 'public.device_add_order_items($1, $2, $3, $4::jsonb)', [
      secret,
      token,
      created.order_id,
      JSON.stringify([pizzaLine('chica', [{ style: CUSTOM, ingredients: ['Jamón'] }])]),
    ])
    const open = await rpc(db, 'public.device_list_open_orders($1)', [secret])
    expect(open[0].order_items).toHaveLength(2)
  })

  it('exposes the pizza catalog without any price', async () => {
    const catalog = await rpc(db, 'public.device_list_catalog($1)', [secret])
    expect(catalog.categories).toBeTruthy()
    expect(catalog.products).toBeTruthy()
    expect(catalog.pizza.sizes).toEqual([
      { code: 'grande', name: 'Grande', allowed_portions: [1, 2, 3, 4], sort_order: 1 },
      { code: 'mediana', name: 'Mediana', allowed_portions: [1, 2], sort_order: 2 },
      { code: 'chica', name: 'Chica', allowed_portions: [1], sort_order: 3 },
    ])
    expect(catalog.pizza.styles).toHaveLength(17)
    expect(catalog.pizza.styles[0].name).toBe(CUSTOM)
    expect(catalog.pizza.ingredients).toHaveLength(15)
    expect(JSON.stringify(catalog.pizza)).not.toMatch(/price|cents/i)
  })

  it('hides inactive styles and ingredients from the device catalog', async () => {
    await asSuperuser(db)
    await db.query(`update public.pizza_styles set active = false where name = 'Estilo Varas'`)
    await db.query(`update public.pizza_ingredients set active = false where name = 'Ajo'`)
    await asAnon(db)
    const catalog = await rpc(db, 'public.device_list_catalog($1)', [secret])
    expect(catalog.pizza.styles).toHaveLength(16)
    expect(catalog.pizza.ingredients).toHaveLength(14)
  })
})
