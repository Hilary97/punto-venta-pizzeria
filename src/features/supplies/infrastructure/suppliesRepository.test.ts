import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  countSupply,
  createSupply,
  listPurchases,
  listSupplies,
  recordPurchase,
  updateSupply,
} from './suppliesRepository'

const { from, rpc, insert, update, select } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
}))

vi.mock('../../../shared/supabase/client', () => ({ getSupabaseClient: () => ({ from, rpc }) }))

const values = { name: 'Queso', unit: 'kg' as const, stockMin: 5, active: true }

beforeEach(() => {
  vi.resetAllMocks()
  insert.mockResolvedValue({ error: null })
  update.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
  select.mockReturnValue({
    order: vi.fn().mockResolvedValue({
      data: [
        { id: 's1', name: 'Queso', unit: 'kg', stock: '3.500', stock_min: '5.000', active: true },
        { id: 's2', name: 'Cajas', unit: 'pz', stock: 40, stock_min: 10, active: false },
      ],
      error: null,
    }),
  })
  from.mockReturnValue({ insert, update, select })
})

describe('supplies repository reads', () => {
  it('selects the supplies columns ordered by name and coerces numerics', async () => {
    const supplies = await listSupplies()
    expect(from).toHaveBeenCalledWith('supplies')
    expect(select).toHaveBeenCalledWith('id, name, unit, stock, stock_min, active')
    expect(select.mock.results[0]!.value.order).toHaveBeenCalledWith('name', { ascending: true })
    expect(supplies).toEqual([
      { id: 's1', name: 'Queso', unit: 'kg', stock: 3.5, stockMin: 5, active: true },
      { id: 's2', name: 'Cajas', unit: 'pz', stock: 40, stockMin: 10, active: false },
    ])
  })

  it('throws a Spanish message when the read fails', async () => {
    select.mockReturnValue({ order: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) })
    await expect(listSupplies()).rejects.toThrow('No se pudieron cargar los insumos.')
  })
})

describe('supplies repository writes', () => {
  it('writes name, unit, minimum and active but never the stock', async () => {
    await createSupply(values)
    await updateSupply('s1', values)
    expect(update.mock.results[0]!.value.eq).toHaveBeenCalledWith('id', 's1')
    for (const payload of [insert.mock.calls[0]![0], update.mock.calls[0]![0]]) {
      expect(payload).toEqual({ name: 'Queso', unit: 'kg', stock_min: 5, active: true })
      expect(payload).not.toHaveProperty('stock')
    }
  })

  it('says the name is taken when the unique name is violated on create or edit', async () => {
    insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key value' } })
    update.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate key value' } }) })
    await expect(createSupply(values)).rejects.toThrow('Ya existe un insumo con ese nombre.')
    await expect(updateSupply('s1', values)).rejects.toThrow('Ya existe un insumo con ese nombre.')
  })

  it('throws Spanish messages when a write fails', async () => {
    insert.mockResolvedValue({ error: { message: 'duplicate' } })
    await expect(createSupply(values)).rejects.toThrow('No se pudo crear el insumo.')
    update.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: { message: 'x' } }) })
    await expect(updateSupply('s1', values)).rejects.toThrow('No se pudo actualizar el insumo.')
  })
})

describe('supplies repository RPCs', () => {
  it('records a purchase through admin_record_supply_purchase', async () => {
    rpc.mockResolvedValue({ data: { supply_id: 's1', stock: 13.5 }, error: null })
    await expect(recordPurchase('s1', 10, 25050)).resolves.toEqual({ supplyId: 's1', stock: 13.5 })
    expect(rpc).toHaveBeenCalledWith('admin_record_supply_purchase', {
      p_supply_id: 's1',
      p_quantity: 10,
      p_cost_cents: 25050,
    })
  })

  it('counts a supply through admin_count_supply', async () => {
    rpc.mockResolvedValue({ data: { supply_id: 's1', stock: '1.250' }, error: null })
    await expect(countSupply('s1', 1.25)).resolves.toEqual({ supplyId: 's1', stock: 1.25 })
    expect(rpc).toHaveBeenCalledWith('admin_count_supply', { p_supply_id: 's1', p_counted: 1.25 })
  })

  it('forwards the server error message', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'El insumo no existe.' } })
    await expect(recordPurchase('s1', 1, 1)).rejects.toThrow('El insumo no existe.')
    await expect(countSupply('s1', 1)).rejects.toThrow('El insumo no existe.')
    await expect(listPurchases('a', 'b')).rejects.toThrow('El insumo no existe.')
  })

  it('falls back to a Spanish message on a malformed payload', async () => {
    rpc.mockResolvedValue({ data: { nope: 1 }, error: null })
    await expect(recordPurchase('s1', 1, 1)).rejects.toThrow('No se pudo registrar la compra.')
    await expect(countSupply('s1', 1)).rejects.toThrow('No se pudo registrar el conteo.')
  })

  it('lists purchases in a range and maps them', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: 'm1',
          supply_id: 's1',
          supply_name: 'Queso',
          unit: 'kg',
          quantity: '10.500',
          cost_cents: 25050,
          created_by_name: 'Ana',
          created_at: '2026-10-05T10:00:00+00:00',
        },
        {
          id: 'm2',
          supply_id: 's2',
          supply_name: 'Cajas',
          unit: 'pz',
          quantity: 40,
          cost_cents: 0,
          created_by_name: null,
          created_at: '2026-10-04T10:00:00+00:00',
        },
      ],
      error: null,
    })
    const purchases = await listPurchases('2026-10-01T06:00:00.000Z', '2026-11-01T06:00:00.000Z')
    expect(rpc).toHaveBeenCalledWith('admin_list_supply_purchases', {
      p_from: '2026-10-01T06:00:00.000Z',
      p_to: '2026-11-01T06:00:00.000Z',
    })
    expect(purchases).toEqual([
      {
        id: 'm1',
        supplyId: 's1',
        supplyName: 'Queso',
        unit: 'kg',
        quantity: 10.5,
        costCents: 25050,
        createdByName: 'Ana',
        createdAt: '2026-10-05T10:00:00+00:00',
      },
      {
        id: 'm2',
        supplyId: 's2',
        supplyName: 'Cajas',
        unit: 'pz',
        quantity: 40,
        costCents: 0,
        createdByName: null,
        createdAt: '2026-10-04T10:00:00+00:00',
      },
    ])
  })

  it('returns an empty list and rejects an unexpected payload', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await expect(listPurchases('a', 'b')).resolves.toEqual([])
    rpc.mockResolvedValue({ data: { not: 'a list' }, error: null })
    await expect(listPurchases('a', 'b')).rejects.toThrow('No se pudo cargar el historial de compras.')
  })
})
