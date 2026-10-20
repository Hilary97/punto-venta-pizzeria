import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listPizzaDough, setPizzaDough } from './pizzaDoughRepository'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../../shared/supabase/client', () => ({ getSupabaseClient: () => ({ rpc }) }))

beforeEach(() => {
  vi.resetAllMocks()
})

describe('listPizzaDough', () => {
  it('maps the day and per-size counts, keeping nulls for sizes without a row', async () => {
    rpc.mockResolvedValue({
      data: {
        business_day: '2026-10-20',
        sizes: [
          { size_code: 'grande', name: 'Grande', prepared: 10, used: 4, left: 6 },
          { size_code: 'chica', name: 'Chica', prepared: null, used: null, left: null },
        ],
      },
      error: null,
    })
    await expect(listPizzaDough()).resolves.toEqual({
      businessDay: '2026-10-20',
      sizes: [
        { sizeCode: 'grande', name: 'Grande', prepared: 10, used: 4, left: 6 },
        { sizeCode: 'chica', name: 'Chica', prepared: null, used: null, left: null },
      ],
    })
    expect(rpc).toHaveBeenCalledWith('admin_list_pizza_dough')
  })

  it('surfaces the server message', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Solo un administrador puede ver las masas.' } })
    await expect(listPizzaDough()).rejects.toThrow('Solo un administrador puede ver las masas.')
  })

  it('rejects an unexpected payload with a generic message', async () => {
    rpc.mockResolvedValue({ data: { nope: true }, error: null })
    await expect(listPizzaDough()).rejects.toThrow('No se pudieron cargar las masas.')
  })
})

describe('setPizzaDough', () => {
  it('calls the RPC with the size and the prepared total', async () => {
    rpc.mockResolvedValue({
      data: { business_day: '2026-10-20', size_code: 'chica', prepared: 12, used: 2, left: 10 },
      error: null,
    })
    await setPizzaDough('chica', 12)
    expect(rpc).toHaveBeenCalledWith('admin_set_pizza_dough', { p_size_code: 'chica', p_prepared: 12 })
  })

  it('surfaces the server rejection', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'No puedes cargar menos masas de las que ya se usaron (5).' },
    })
    await expect(setPizzaDough('chica', 1)).rejects.toThrow('No puedes cargar menos masas de las que ya se usaron (5).')
  })
})
