import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getScheduledLeadMinutes, setScheduledLeadMinutes } from './orderSettingsRepository'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../../shared/supabase/client', () => ({ getSupabaseClient: () => ({ rpc }) }))

beforeEach(() => {
  rpc.mockReset()
})

describe('getScheduledLeadMinutes', () => {
  it('reads the lead minutes from get_order_settings', async () => {
    rpc.mockResolvedValue({ data: { scheduled_lead_minutes: 20 }, error: null })

    await expect(getScheduledLeadMinutes()).resolves.toBe(20)
    expect(rpc).toHaveBeenCalledWith('get_order_settings')
  })

  it('fails with the fallback message on an unexpected payload', async () => {
    rpc.mockResolvedValue({ data: { other: 1 }, error: null })

    await expect(getScheduledLeadMinutes()).rejects.toThrow('No se pudo cargar la anticipación.')
  })
})

describe('setScheduledLeadMinutes', () => {
  it('sends p_minutes and returns the saved value', async () => {
    rpc.mockResolvedValue({ data: { scheduled_lead_minutes: 45 }, error: null })

    await expect(setScheduledLeadMinutes(45)).resolves.toBe(45)
    expect(rpc).toHaveBeenCalledWith('admin_set_scheduled_lead_minutes', { p_minutes: 45 })
  })

  it('surfaces the server message', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'La anticipación debe estar entre 0 y 240 minutos.' } })

    await expect(setScheduledLeadMinutes(300)).rejects.toThrow('La anticipación debe estar entre 0 y 240 minutos.')
  })
})
